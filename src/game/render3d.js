// 3D renderer (Three.js / WebGL). Reads the SAME `world` state the 2D
// renderer uses — boat pose, entities, wind, time — so the simulation is
// identical in every view; only the presentation differs.
//
// Coordinate mapping: the sim is 2D (x east, y south, heading 0 = +x).
// In 3D (Y-up) we map world (x, y) → (x, 0, y) and rotate the boat about Y
// by -heading so its local +X (bow) points along the heading.
//
// Two cameras:
//   • aerial  — elevated chase cam following the boat
//   • cockpit — first-person at the helm; the raised bow sits in the lower
//               field of view and occludes the near water ahead, so judging
//               distance to obstacles directly in front is genuinely tricky
//               (exactly as on a real boat).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { cleatWorld, anchorWorld } from './mooring.js';

// Wave field — kept in lock-step with the GLSL waveH() in the water material
// so boats and buoys bob exactly with the surface they sit on. (x, z) are
// WORLD coordinates.
function waveHeight(x, z, t) {
  let h = 0;
  h += 0.16 * Math.sin(x * 0.22 + t * 0.8);
  h += 0.11 * Math.sin(x * 0.43 + z * 0.61 + t * 1.2);
  h += 0.07 * Math.sin(z * 0.9 - t * 0.6);
  h += 0.04 * Math.sin((x - z) * 1.5 + t * 1.7);
  return h;
}

// Sun direction (golden-hour low sun) shared by the sky, lights and reflections.
const SUN_POS = new THREE.Vector3(60, 18, -38);

export function createRenderer3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Filmic tone mapping is what gives PBR water its cinematic, non-flat look.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  // Haze near the horizon hides the finite water plane's edge and ties the
  // sea into the sky. Colour is a light atmospheric blue (the horizon tint).
  scene.fog = new THREE.Fog('#9fc1d6', 70, 230);

  // Atmospheric sky (three's physically-based Sky shader) at a low sun.
  const sky = new Sky();
  sky.scale.setScalar(10000);
  sky.material.uniforms.turbidity.value = 6;
  sky.material.uniforms.rayleigh.value = 2.2;
  sky.material.uniforms.mieCoefficient.value = 0.005;
  sky.material.uniforms.mieDirectionalG.value = 0.85;
  sky.material.uniforms.sunPosition.value.copy(SUN_POS);

  // Build an environment map from the sky so the metallic water (and the
  // boat) actually reflect the sky — the key to realistic-looking water.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const envRT = pmrem.fromScene(envScene);
  scene.environment = envRT.texture;
  scene.add(sky); // move the sky into the main scene as the backdrop
  pmrem.dispose();

  // Lighting — warm golden sun + cool sky fill + hemisphere ambient.
  const sun = new THREE.DirectionalLight('#ffd9b0', 1.6);
  sun.position.copy(SUN_POS);
  scene.add(sun);
  scene.add(new THREE.AmbientLight('#ffffff', 0.25));
  scene.add(new THREE.HemisphereLight('#86b0d8', '#0a2438', 0.45));

  // Water.
  const water = makeWater();
  scene.add(water.mesh);

  // Player boat.
  const boat = makeBoat();
  scene.add(boat.group);

  // Entity meshes, keyed by entity id (created/updated/removed lazily).
  const entityMeshes = new Map();

  // Tracking overlay: a path line on the water + flat pose-ghost silhouettes.
  const TRACK_MAX = 8000;
  const trackPos = new Float32Array(TRACK_MAX * 3);
  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute('position', new THREE.BufferAttribute(trackPos, 3));
  trackGeo.setDrawRange(0, 0);
  const trackLine = new THREE.Line(
    trackGeo,
    new THREE.LineBasicMaterial({ color: '#8cebff', transparent: true, opacity: 0.9 })
  );
  trackLine.frustumCulled = false;
  scene.add(trackLine);

  const ghostGeo = new THREE.ShapeGeometry(hullShape(6, 2.2));
  ghostGeo.rotateX(-Math.PI / 2); // lie flat on the water
  const ghostMat = new THREE.MeshBasicMaterial({
    color: '#ffe082', transparent: true, opacity: 0.32, side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ghostPool = [];
  const ghostRoot = new THREE.Group();
  scene.add(ghostRoot);

  // Mooring lines — one short THREE.Line per active line, recoloured by tension.
  const moorPool = [];
  const moorRoot = new THREE.Group();
  scene.add(moorRoot);

  function syncMooring(world, time) {
    const lines = world.mooring ? world.mooring.lines : [];
    const bob = waveHeight(world.boat.x, world.boat.y, time);
    while (moorPool.length < lines.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: '#ffd27a' });
      const ln = new THREE.Line(geo, mat);
      ln.frustumCulled = false;
      moorPool.push({ ln, geo, mat });
      moorRoot.add(ln);
    }
    for (let i = 0; i < moorPool.length; i++) {
      const rec = moorPool[i];
      if (i >= lines.length) { rec.ln.visible = false; continue; }
      const line = lines[i];
      const cw = cleatWorld(world.boat, line);
      const a = anchorWorld(world, line);
      if (!a) { rec.ln.visible = false; continue; }
      const dist = Math.hypot(a.x - cw.x, a.y - cw.y);
      const taut = dist > line.restLength + 0.05;
      const pos = rec.geo.attributes.position.array;
      pos[0] = cw.x; pos[1] = 0.62 + bob; pos[2] = cw.y;
      pos[3] = a.x;  pos[4] = 0.5;        pos[5] = a.y;
      rec.geo.attributes.position.needsUpdate = true;
      rec.mat.color.set(taut ? '#ff5a46' : '#ffd27a');
      rec.ln.visible = true;
    }
  }

  function syncTrack(world, time) {
    const tr = world.track;
    // Path line — ride the wave surface so it sits on the water.
    const n = Math.min(tr.path.length, TRACK_MAX);
    for (let i = 0; i < n; i++) {
      const p = tr.path[i];
      trackPos[i * 3] = p.x;
      trackPos[i * 3 + 1] = waveHeight(p.x, p.y, time) + 0.12;
      trackPos[i * 3 + 2] = p.y;
    }
    trackGeo.setDrawRange(0, n);
    trackGeo.attributes.position.needsUpdate = true;
    trackLine.visible = n >= 2;

    // Pose ghosts.
    const gn = tr.ghosts.length;
    while (ghostPool.length < gn) {
      const m = new THREE.Mesh(ghostGeo, ghostMat);
      ghostPool.push(m);
      ghostRoot.add(m);
    }
    for (let i = 0; i < ghostPool.length; i++) {
      const m = ghostPool[i];
      if (i < gn) {
        const g = tr.ghosts[i];
        m.visible = true;
        m.position.set(g.x, waveHeight(g.x, g.y, time) + 0.1, g.y);
        m.rotation.y = -g.heading;
      } else {
        m.visible = false;
      }
    }
  }

  // Cameras.
  const aerialCam = new THREE.PerspectiveCamera(52, 1, 0.1, 2000);
  const cockpitCam = new THREE.PerspectiveCamera(72, 1, 0.05, 2000);

  // The cockpit camera is PARENTED to the boat, so it rolls/pitches with the
  // hull. The bow geometry therefore stays in a fixed place in the frame no
  // matter how the boat turns — instead of the bow swinging up into view, the
  // horizon tilts (exactly how it looks from a real helm). Eye at the helm.
  const cockpitRig = new THREE.Object3D();
  cockpitRig.position.set(-0.2, 1.62, -0.45);
  boat.group.add(cockpitRig);
  cockpitCam.rotation.order = 'YXZ';
  cockpitCam.rotation.set(-0.05, -Math.PI / 2, 0); // face the bow (+X), slight downward
  cockpitRig.add(cockpitCam);

  const _fwd = new THREE.Vector3();
  const _lat = new THREE.Vector3();
  const _tmp = new THREE.Vector3();

  function syncEntities(world) {
    const seen = new Set();
    for (const e of world.entities) {
      seen.add(e.id);
      let rec = entityMeshes.get(e.id);
      if (!rec) {
        rec = makeEntityMesh(e);
        entityMeshes.set(e.id, rec);
        scene.add(rec.group);
      }
      const bob = rec.floats ? waveHeight(e.x, e.y, world.time) : 0;
      rec.group.position.set(e.x, rec.baseY + bob, e.y);
      rec.group.rotation.y = -e.heading;
    }
    for (const [id, rec] of entityMeshes) {
      if (!seen.has(id)) {
        scene.remove(rec.group);
        disposeObject(rec.group);
        entityMeshes.delete(id);
      }
    }
  }

  function draw(world, mode, w, h) {
    const b = world.boat;
    _fwd.set(Math.cos(b.heading), 0, Math.sin(b.heading));
    _lat.set(-Math.sin(b.heading), 0, Math.cos(b.heading)); // body +y (starboard)

    // Boat transform + gentle bob/roll/pitch from the wave field & motion.
    const bob = waveHeight(b.x, b.y, world.time);
    boat.group.position.set(b.x, bob, b.y);
    boat.group.rotation.set(0, -b.heading, 0);
    // Roll into turns (lean away from the turn) + slight pitch with throttle.
    const speed = Math.hypot(b.vx, b.vy);
    // Gentler roll/pitch so the horizon tilt in cockpit stays subtle.
    boat.group.rotation.z = THREE.MathUtils.clamp(-b.omega * speed * 0.04, -0.14, 0.14);
    boat.group.rotation.x = THREE.MathUtils.clamp(-b.throttle * 0.03, -0.05, 0.05);
    boat.update(b);
    boat.group.updateMatrixWorld(true); // refresh the parented cockpit rig

    syncEntities(world);
    syncTrack(world, world.time);
    syncMooring(world, world.time);
    water.update(world.time, b.x, b.y);

    let cam;
    if (mode === 'cockpit') {
      // Camera is fixed to the helm rig — nothing to position per frame.
      cam = cockpitCam;
    } else {
      // Chase cam, raised and pulled back, aiming below the boat so the hull
      // rides in the upper-centre of the frame — clear of the control overlay
      // along the bottom edge.
      const dist = 21;
      const height = 16;
      aerialCam.position.set(b.x - _fwd.x * dist, height, b.y - _fwd.z * dist);
      aerialCam.lookAt(b.x + _fwd.x * 2, -11, b.y + _fwd.z * 2);
      aerialCam.updateMatrixWorld(true);
      cam = aerialCam;
    }
    if (cam.aspect !== w / h) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    renderer.render(scene, cam);
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
  }

  function dispose() {
    for (const [, rec] of entityMeshes) disposeObject(rec.group);
    entityMeshes.clear();
    trackGeo.dispose();
    trackLine.material.dispose();
    ghostGeo.dispose();
    ghostMat.dispose();
    if (envRT) envRT.dispose();
    renderer.dispose();
  }

  return { draw, resize, dispose };
}

// ---------------- Water ----------------

// Realistic PBR water: a MeshStandardMaterial (so it reflects the sky
// environment with proper Fresnel + sun specular) whose vertex shader is
// patched via onBeforeCompile to add summed sine waves and recompute normals.
// This is the technique that gives the surface depth and life rather than the
// flat look of a hand-rolled shader.
function makeWater() {
  const SIZE = 520;
  const SEG = 256;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2); // lie flat in XZ, normal +Y

  const uniforms = {
    uTime: { value: 0 },
    uOffset: { value: new THREE.Vector2(0, 0) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: '#0d3a57',
    roughness: 0.38,
    metalness: 0.6,
  });

  // GLSL wave field — MUST mirror waveHeight() above. p is WORLD XZ.
  const WAVE_GLSL = `
    uniform float uTime;
    uniform vec2 uOffset;
    float waveH(vec2 p, float t) {
      float h = 0.0;
      h += 0.16 * sin(p.x * 0.22 + t * 0.8);
      h += 0.11 * sin(p.x * 0.43 + p.y * 0.61 + t * 1.2);
      h += 0.07 * sin(p.y * 0.90 - t * 0.6);
      h += 0.04 * sin((p.x - p.y) * 1.50 + t * 1.7);
      return h;
    }
  `;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uOffset = uniforms.uOffset;
    shader.vertexShader = WAVE_GLSL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        `
        vec2 wp = position.xz + uOffset;
        float hC = waveH(wp, uTime);
        float e = 0.6;
        float hX = waveH(wp + vec2(e, 0.0), uTime);
        float hZ = waveH(wp + vec2(0.0, e), uTime);
        vec3 objectNormal = normalize(vec3(-(hX - hC) / e, 1.0, -(hZ - hC) / e));
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
        #endif
        `
      )
      .replace(
        '#include <begin_vertex>',
        `
        vec3 transformed = vec3(position);
        transformed.y += hC;
        `
      );
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return {
    mesh,
    material,
    update(time, cx, cz) {
      mesh.position.set(cx, 0, cz);
      uniforms.uTime.value = time;
      uniforms.uOffset.value.set(cx, cz);
    },
  };
}

// ---------------- Shared boat-building kit ----------------
// Reusable PBR materials (shared across all hulls → cheap) and geometry
// helpers so every boat — player and parked — gets a properly sculpted hull,
// rubrail, windscreen, rails, seats, etc. instead of a plain box.

const MAT = {
  white: new THREE.MeshStandardMaterial({ color: '#eef2f7', roughness: 0.32, metalness: 0.12 }),
  cream: new THREE.MeshStandardMaterial({ color: '#efe9d6', roughness: 0.4, metalness: 0.1 }),
  navy: new THREE.MeshStandardMaterial({ color: '#1f3f63', roughness: 0.45, metalness: 0.25 }),
  cabin: new THREE.MeshStandardMaterial({ color: '#f6f8fb', roughness: 0.3, metalness: 0.15 }),
  teak: new THREE.MeshStandardMaterial({ color: '#b5894f', roughness: 0.75 }),
  cockpit: new THREE.MeshStandardMaterial({ color: '#1a3047', roughness: 0.7 }),
  glass: new THREE.MeshStandardMaterial({ color: '#a9d4e8', roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.42 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#e3e9ef', roughness: 0.18, metalness: 0.95 }),
  dark: new THREE.MeshStandardMaterial({ color: '#11181f', roughness: 0.5, metalness: 0.3 }),
  seat: new THREE.MeshStandardMaterial({ color: '#48566c', roughness: 0.85 }),
  motor: new THREE.MeshStandardMaterial({ color: '#1a212b', roughness: 0.4, metalness: 0.45 }),
  motorRed: new THREE.MeshStandardMaterial({ color: '#cf2f2a', roughness: 0.4, metalness: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: '#86663d', roughness: 0.85 }),
  pontoon: new THREE.MeshStandardMaterial({ color: '#39434f', roughness: 0.7, metalness: 0.2 }),
  red: new THREE.MeshStandardMaterial({ color: '#d63030', roughness: 0.45, emissive: '#3a0000' }),
  green: new THREE.MeshStandardMaterial({ color: '#1f9e54', roughness: 0.45, emissive: '#002a10' }),
  sail: new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide }),
};

const HULL_PALETTE_3D = ['#eef2f7', '#e9edf2', '#2c5577', '#7c2730', '#23635a', '#efe9d6'];
const _hullMatCache = new Map();
function hullMat(color) {
  let m = _hullMatCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.12 });
    _hullMatCache.set(color, m);
  }
  return m;
}
function entityHullColor(e) {
  const s = String(e.id || e.presetId || 'x');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return HULL_PALETTE_3D[h % HULL_PALETTE_3D.length];
}

// Top-down hull outline: fine bow, max beam ~1/3 aft, flat transom.
function hullShape(L, W) {
  const hl = L / 2, hw = W / 2;
  const s = new THREE.Shape();
  s.moveTo(hl, 0);
  s.bezierCurveTo(hl * 0.97, hw * 0.46, hl * 0.55, hw, hl * 0.06, hw);
  s.lineTo(-hl * 0.78, hw * 0.95);
  s.quadraticCurveTo(-hl, hw * 0.9, -hl, hw * 0.6);
  s.lineTo(-hl, -hw * 0.6);
  s.quadraticCurveTo(-hl, -hw * 0.9, -hl * 0.78, -hw * 0.95);
  s.lineTo(hl * 0.06, -hw);
  s.bezierCurveTo(hl * 0.55, -hw, hl * 0.97, -hw * 0.46, hl, 0);
  return s;
}

// Sculpted hull solid (rounded gunwale via bevel). Returns the mesh; the deck
// top sits at y = fb - submerge.
function buildHull(L, W, fb, mat, submerge = 0.32) {
  const geo = new THREE.ExtrudeGeometry(hullShape(L, W), {
    depth: fb, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.13, bevelSegments: 3, steps: 1,
  });
  geo.rotateX(-Math.PI / 2); // lie flat: +X bow, +Y up, beam along Z
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -submerge;
  m.castShadow = true;
  return m;
}

// Navy rubrail stripe running round the gunwale (an elliptical ring).
function rubrail(group, L, W, y) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), MAT.navy);
  t.rotation.x = Math.PI / 2;
  t.scale.set(L / 2 + 0.02, W / 2 + 0.03, 1);
  t.position.y = y;
  group.add(t);
}

// Inset teak/cockpit recess in the aft deck. `s` scales the depth with size.
function cockpitWell(group, fromX, toX, beam, deckY, s = 1) {
  const len = fromX - toX;
  const well = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42 * s, beam), MAT.cockpit);
  well.position.set((fromX + toX) / 2, deckY - 0.12 * s, 0);
  group.add(well);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.06, beam * 0.94), MAT.teak);
  sole.position.set((fromX + toX) / 2, deckY - 0.3 * s, 0);
  group.add(sole);
}

// Raked wrap windscreen: tinted glass + chrome top rail.
function windscreen(group, x, deckY, beam, height) {
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, height, beam * 0.92), MAT.glass);
  glass.position.set(x, deckY + height * 0.5, 0);
  glass.rotation.z = 0.32;
  group.add(glass);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.05, height * 0.82, beam * 0.34), MAT.glass);
    wing.position.set(x - 0.16, deckY + height * 0.42, s * beam * 0.5);
    wing.rotation.z = 0.32;
    wing.rotation.y = s * 0.55;
    group.add(wing);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, beam * 0.95), MAT.chrome);
  rail.position.set(x + Math.sin(0.32) * height, deckY + height * 0.96, 0);
  group.add(rail);
}

// Stanchion bow rails down both sides of the foredeck. `sc` scales rail height.
function bowRails(group, L, W, deckY, sc = 1) {
  const hl = L / 2, hw = W / 2;
  for (const s of [-1, 1]) {
    const pts = [
      new THREE.Vector3(hl * 0.92, deckY + 0.05 * sc, s * hw * 0.18),
      new THREE.Vector3(hl * 0.6, deckY + 0.34 * sc, s * hw * 0.7),
      new THREE.Vector3(hl * 0.2, deckY + 0.4 * sc, s * hw * 0.86),
    ];
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.028, 6, false),
      MAT.chrome
    );
    group.add(tube);
    for (const p of pts.slice(1)) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, p.y - deckY, 6), MAT.chrome);
      st.position.set(p.x, (p.y + deckY) / 2, p.z);
      group.add(st);
    }
  }
}

function seat(group, x, z, size) {
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(size, 0.16, size * 0.92), MAT.seat);
  cushion.position.set(x, 0, z);
  const back = new THREE.Mesh(new THREE.BoxGeometry(size * 0.3, 0.4, size * 0.92), MAT.seat);
  back.position.set(x - size * 0.5, 0.22, z);
  const g = new THREE.Group();
  g.add(cushion, back);
  group.add(g);
  return g;
}

function cleat(group, x, z, deckY) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.08), MAT.chrome);
  c.position.set(x, deckY + 0.04, z);
  group.add(c);
}

function navLights(group, L, W, deckY) {
  const hl = L / 2, hw = W / 2;
  const r = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), MAT.red);
  r.position.set(hl * 0.82, deckY + 0.1, -hw * 0.5);
  const g = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), MAT.green);
  g.position.set(hl * 0.82, deckY + 0.1, hw * 0.5);
  group.add(r, g);
}

// Outboard motor sub-group (cowling + midsection + lower unit + skeg/prop).
function buildOutboard(scale = 1) {
  const m = new THREE.Group();
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.45 * scale, 0.5 * scale, 0.36 * scale), MAT.motor);
  cowl.position.set(-0.2 * scale, 0.5 * scale, 0);
  m.add(cowl);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.46 * scale, 0.06 * scale, 0.37 * scale), MAT.motorRed);
  stripe.position.set(-0.2 * scale, 0.3 * scale, 0);
  m.add(stripe);
  const mid = new THREE.Mesh(new THREE.BoxGeometry(0.16 * scale, 0.5 * scale, 0.16 * scale), MAT.motor);
  mid.position.set(-0.2 * scale, 0.0, 0);
  m.add(mid);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.05 * scale, 0.5 * scale, 8), MAT.motor);
  lower.rotation.z = Math.PI / 2;
  lower.position.set(-0.35 * scale, -0.32 * scale, 0);
  m.add(lower);
  const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.18 * scale, 0.03 * scale), MAT.motor);
  skeg.position.set(-0.48 * scale, -0.42 * scale, 0);
  m.add(skeg);
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * scale, 0.09 * scale, 0.03 * scale, 8), MAT.chrome);
  prop.rotation.z = Math.PI / 2;
  prop.position.set(-0.58 * scale, -0.32 * scale, 0);
  m.add(prop);
  return m;
}

// Cabin superstructure with window band; optional flybridge on top.
// `s` scales the superstructure height with the boat's size.
function buildCabin(group, L, W, deckY, fly, s = 1) {
  const cabFwd = L * 0.34, cabAft = -L * 0.18, cabH = 0.78 * s;
  const cabLen = cabFwd - cabAft, cabBeam = W * 0.72;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabLen, cabH, cabBeam), MAT.cabin);
  cabin.position.set((cabFwd + cabAft) / 2, deckY + cabH / 2, 0);
  group.add(cabin);
  // Raked front windscreen.
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.06, cabH * 0.7, cabBeam * 0.92), MAT.glass);
  front.position.set(cabFwd, deckY + cabH * 0.55, 0);
  front.rotation.z = 0.4;
  group.add(front);
  // Side window strips.
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(cabLen * 0.8, cabH * 0.3, 0.04), MAT.glass);
    win.position.set((cabFwd + cabAft) / 2, deckY + cabH * 0.58, s * cabBeam * 0.5);
    group.add(win);
  }
  // Radar arch + dome aft of the cabin.
  for (const sd of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7 * s, 6), MAT.chrome);
    leg.position.set(cabAft - 0.1, deckY + cabH + 0.35 * s, sd * cabBeam * 0.42);
    group.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, cabBeam * 0.9), MAT.chrome);
  bar.position.set(cabAft - 0.1, deckY + cabH + 0.7 * s, 0);
  group.add(bar);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), MAT.white);
  dome.position.set(cabAft - 0.1, deckY + cabH + 0.82 * s, 0);
  group.add(dome);
  if (fly) {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(cabLen * 0.7, 0.5 * s, cabBeam * 0.86), MAT.cabin);
    bridge.position.set((cabFwd + cabAft) / 2 - L * 0.02, deckY + cabH + 0.3 * s, 0);
    group.add(bridge);
    seat(group, (cabFwd + cabAft) / 2 - L * 0.05, 0, 0.5).position.y = deckY + cabH + 0.62 * s;
  }
}

// Sail rig: mast + boom + a billowed mainsail (curved cylinder slice).
function buildSailRig(group, L, W, deckY) {
  const mastX = L * 0.12, mastH = L * 1.5;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, mastH, 8), MAT.chrome);
  mast.position.set(mastX, deckY + mastH / 2, 0);
  group.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, L * 0.7, 8), MAT.chrome);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(mastX - L * 0.32, deckY + 0.5, 0);
  group.add(boom);
  // Billowed mainsail — an arc of a thin cylinder.
  const sailGeo = new THREE.CylinderGeometry(L * 0.45, L * 0.45, mastH * 0.8, 16, 1, true, Math.PI * 0.15, Math.PI * 0.5);
  const sail = new THREE.Mesh(sailGeo, MAT.sail);
  sail.scale.set(1, 1, 0.7);
  sail.position.set(mastX - L * 0.18, deckY + mastH * 0.45, -0.05);
  sail.rotation.y = Math.PI * 0.5;
  group.add(sail);
  // Jib forward.
  const jib = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.3, L * 0.3, mastH * 0.55, 14, 1, true, Math.PI * 0.18, Math.PI * 0.42), MAT.sail);
  jib.scale.set(1, 1, 0.55);
  jib.position.set(mastX + L * 0.25, deckY + mastH * 0.34, 0.05);
  jib.rotation.y = Math.PI * 0.5;
  group.add(jib);
}

// ---------------- Player boat (detailed bowrider) ----------------

function makeBoat() {
  const group = new THREE.Group();
  const L = 6, W = 2.2, fb = 0.95;
  const hull = buildHull(L, W, fb, MAT.white);
  group.add(hull);
  const deckY = fb - 0.32;

  rubrail(group, L, W, deckY + 0.02);

  // Foredeck cap (raised) + aft cockpit recess.
  const fore = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, 0.16, W * 0.9), MAT.white);
  fore.position.set(L * 0.28, deckY + 0.06, 0);
  group.add(fore);
  cockpitWell(group, L * 0.06, -L * 0.86, W * 0.82, deckY);

  windscreen(group, L * 0.06, deckY, W, 0.5);

  // Helm console + wheel (animated).
  const console3d = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.7), MAT.dark);
  console3d.position.set(-L * 0.04, deckY + 0.18, -W * 0.22);
  group.add(console3d);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 10, 24), MAT.chrome);
  wheel.position.set(-L * 0.04 + 0.28, deckY + 0.4, -W * 0.22);
  wheel.rotation.y = Math.PI / 2;
  group.add(wheel);

  // Captain + passenger seats and a stern bench.
  seat(group, -L * 0.1, -W * 0.24, 0.5).position.y = deckY + 0.1;
  seat(group, -L * 0.1, W * 0.24, 0.5).position.y = deckY + 0.1;
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, W * 0.8), MAT.seat);
  bench.position.set(-L * 0.78, deckY + 0.1, 0);
  group.add(bench);

  bowRails(group, L, W, deckY);
  navLights(group, L, W, deckY);
  cleat(group, L * 0.42, W * 0.46, deckY);
  cleat(group, L * 0.42, -W * 0.46, deckY);
  cleat(group, 0, 0, deckY); // amidships
  cleat(group, -L * 0.42, W * 0.46, deckY);
  cleat(group, -L * 0.42, -W * 0.46, deckY);

  // Swim platform + outboard at the transom (swivels with the rudder).
  const platform = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, W * 0.7), MAT.teak);
  platform.position.set(-L / 2 - 0.2, deckY - 0.18, 0);
  group.add(platform);
  const motor = buildOutboard(1);
  motor.position.set(-L / 2 - 0.05, deckY - 0.1, 0);
  group.add(motor);

  return {
    group,
    update(b) {
      motor.rotation.y = -b.rudder * 0.5;
      wheel.rotation.x = b.rudderTarget * 2.4;
    },
  };
}

// ---------------- Entities ----------------

const BUOY_COLORS3D = {
  'buoy-red': '#d63030',
  'buoy-green': '#1f9e54',
  'buoy-yellow': '#e8c33a',
  'buoy-mooring': '#e8ecf0',
};

function makeEntityMesh(e) {
  const group = new THREE.Group();

  if (e.category === 'dock') {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(e.length, 0.18, e.width), MAT.wood);
    deck.position.y = 0.32;
    deck.castShadow = true;
    group.add(deck);
    // Plank seams.
    const seams = Math.max(2, Math.floor(e.length / 1.6));
    for (let i = 1; i < seams; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.19, e.width), MAT.dark);
      seam.position.set(-e.length / 2 + (e.length / seams) * i, 0.33, 0);
      group.add(seam);
    }
    // Twin pontoon floats.
    for (const sz of [-1, 1]) {
      const pon = new THREE.Mesh(new THREE.BoxGeometry(e.length * 0.96, 0.26, e.width * 0.3), MAT.pontoon);
      pon.position.set(0, 0.08, sz * (e.width * 0.3));
      group.add(pon);
    }
    // Chrome cleats along the edges.
    for (const sx of [-0.4, 0.4]) {
      for (const sz of [-0.42, 0.42]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), MAT.chrome);
        c.position.set(e.length * sx, 0.44, e.width * sz);
        group.add(c);
      }
    }
    return { group, baseY: 0.12, floats: true };
  }

  if (e.category === 'bollard') {
    const r = e.length * 0.5;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.9, 14), MAT.dark);
    post.position.y = 0.45;
    post.castShadow = true;
    group.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.85, 12, 8), MAT.dark);
    cap.position.y = 0.9;
    cap.scale.y = 0.6;
    group.add(cap);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.14, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: '#e6be3c', roughness: 0.5 })
    );
    band.position.y = 0.6;
    group.add(band);
    return { group, baseY: 0, floats: false };
  }

  if (e.category === 'buoy' && e.beacon) {
    // Lighthouse / channel beacon.
    const r = e.length * 0.5;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.5, 16), MAT.pontoon);
    base.position.y = 0.25;
    group.add(base);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r * (0.55 - i * 0.06), r * (0.62 - i * 0.06), 0.7, 16),
        new THREE.MeshStandardMaterial({ color: i % 2 ? '#cf2f2a' : '#f4f6f8', roughness: 0.55 })
      );
      seg.position.y = 0.6 + i * 0.68;
      group.add(seg);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.18, 14), MAT.dark);
    gallery.position.y = 0.6 + 4 * 0.68;
    group.add(gallery);
    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.36, r * 0.36, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffdf6e', emissiveIntensity: 0.9, roughness: 0.3 })
    );
    lantern.position.y = 0.6 + 4 * 0.68 + 0.34;
    group.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, 0.4, 12), MAT.dark);
    roof.position.y = 0.6 + 4 * 0.68 + 0.75;
    group.add(roof);
    return { group, baseY: 0, floats: false };
  }

  if (e.category === 'buoy') {
    const color = BUOY_COLORS3D[e.presetId] || '#e8c33a';
    const r = e.length * 0.5;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.15 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
    body.position.y = r * 0.7;
    group.add(body);
    // Reflective band.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, r * 0.3, 18, 1, true), MAT.cabin);
    band.position.y = r * 0.7;
    group.add(band);
    // Can topmark + light.
    const can = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.5, r * 0.7, 12), mat);
    can.position.y = r * 1.5;
    group.add(can);
    const light = new THREE.Mesh(new THREE.SphereGeometry(r * 0.18, 8, 6),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 }));
    light.position.y = r * 1.95;
    group.add(light);
    return { group, baseY: 0, floats: true };
  }

  // ---- Parked boats ----
  const L = e.length, W = e.width;
  const color = entityHullColor(e);
  // Size scale → bigger boats stand taller out of the water (more freeboard
  // and taller superstructure), small ones sit low. This is what gives each
  // boat a realistic height instead of every hull being the same low slab.
  const sz = Math.max(0.8, Math.min(2.4, L / 6.5));

  if (e.hull === 'cat') {
    const hullHalfW = Math.max(0.5, W * 0.16);
    const off = W * 0.5 - hullHalfW;
    const fb = 0.75 * sz;
    const sub = 0.28 * sz;
    const deckY = fb - sub;
    for (const side of [-1, 1]) {
      const h = buildHull(L, hullHalfW * 2, fb, hullMat(color), sub);
      h.position.z = side * off;
      group.add(h);
    }
    // Cross beams + bridge deck + cabin (heights scale with size).
    for (const bx of [L * 0.3, -L * 0.3]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, off * 2), MAT.chrome);
      beam.position.set(bx, deckY + 0.05, 0);
      group.add(beam);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(L * 0.55, 0.16, off * 1.7), MAT.cabin);
    bridge.position.set(-L * 0.05, deckY + 0.12, 0);
    group.add(bridge);
    const cabinH = 0.7 * sz;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, cabinH, off * 1.4), MAT.cabin);
    cabin.position.set(0, deckY + 0.2 + cabinH / 2, 0);
    group.add(cabin);
    const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, cabinH * 0.5, off * 1.3), MAT.glass);
    cabinGlass.position.set(L * 0.2, deckY + 0.2 + cabinH * 0.55, 0);
    cabinGlass.rotation.z = 0.4;
    group.add(cabinGlass);
    const tramp = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.5, off * 1.6), MAT.cockpit);
    tramp.rotation.x = -Math.PI / 2;
    tramp.position.set(L * 0.5, deckY + 0.04, 0);
    group.add(tramp);
    return { group, baseY: 0, floats: true };
  }

  // Monohull (motor or sail).
  const fb = (e.cabin ? 0.95 : 0.78) * sz;
  const sub = 0.3 * sz;
  const hull = buildHull(L, W, fb, hullMat(color), sub);
  group.add(hull);
  const deckY = fb - sub;
  rubrail(group, L, W, deckY + 0.02);

  if (e.sail) {
    cockpitWell(group, L * 0.0, -L * 0.7, W * 0.7, deckY, sz);
    buildSailRig(group, L, W, deckY);
  } else if (e.cabin) {
    buildCabin(group, L, W, deckY, L >= 15, sz); // flybridge on the big yacht
    bowRails(group, L, W, deckY, sz);
    cleat(group, L * 0.42, W * 0.45, deckY);
    cleat(group, -L * 0.42, W * 0.45, deckY);
    cleat(group, L * 0.42, -W * 0.45, deckY);
    cleat(group, -L * 0.42, -W * 0.45, deckY);
  } else {
    // Small open boat (dinghy / runabout).
    cockpitWell(group, L * 0.1, -L * 0.7, W * 0.74, deckY, sz);
    if (L >= 5) windscreen(group, L * 0.1, deckY, W, 0.42 * sz);
    const motor = buildOutboard(0.8 * sz);
    motor.position.set(-L / 2 - 0.05, deckY - 0.05, 0);
    group.add(motor);
    bowRails(group, L, W, deckY, sz);
  }
  navLights(group, L, W, deckY);
  return { group, baseY: 0, floats: true };
}

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}
