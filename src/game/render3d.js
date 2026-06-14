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

// Shared wave field — must match the water shader closely enough that boats
// and buoys bob with the surface they sit on.
const WAVES = [
  { dx: 1.0, dz: 0.0, freq: 0.18, amp: 0.16, speed: 0.9 },
  { dx: 0.6, dz: 0.8, freq: 0.30, amp: 0.09, speed: 1.3 },
  { dx: -0.8, dz: 0.5, freq: 0.55, amp: 0.045, speed: 1.8 },
];

function waveHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) {
    h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.freq + t * w.speed);
  }
  return h;
}

export function createRenderer3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9cfe4');
  scene.fog = new THREE.Fog('#bcd9e8', 70, 340);

  // Lighting: soft sky/sea hemisphere + a warm low sun.
  scene.add(new THREE.HemisphereLight('#dcefff', '#0b3142', 1.0));
  const sun = new THREE.DirectionalLight('#fff2cf', 1.15);
  sun.position.set(80, 90, -40);
  scene.add(sun);
  const sunDir = sun.position.clone().normalize();

  // Sky dome — a big inverted sphere with a vertical gradient.
  scene.add(makeSky());

  // Water.
  const water = makeWater(sunDir);
  scene.add(water.mesh);

  // Player boat.
  const boat = makeBoat();
  scene.add(boat.group);

  // Entity meshes, keyed by entity id (created/updated/removed lazily).
  const entityMeshes = new Map();

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
    cam.getWorldPosition(_tmp);
    water.material.uniforms.uCam.value.copy(_tmp);
    renderer.render(scene, cam);
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
  }

  function dispose() {
    for (const [, rec] of entityMeshes) disposeObject(rec.group);
    entityMeshes.clear();
    renderer.dispose();
  }

  return { draw, resize, dispose };
}

// ---------------- Water ----------------

function makeWater(sunDir) {
  const SIZE = 700;
  const SEG = 180;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2); // lie flat in XZ, normal +Y

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uCam: { value: new THREE.Vector3() },
      uSunDir: { value: sunDir.clone() },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec2 uOffset;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vec3 pos = position;
        vec2 wp = pos.xz + uOffset;
        float h = 0.0, dhx = 0.0, dhz = 0.0;
        // wave 1
        float p1 = (1.0*wp.x + 0.0*wp.y)*0.18 + uTime*0.9;
        h += 0.16*sin(p1); dhx += 0.16*0.18*1.0*cos(p1); dhz += 0.16*0.18*0.0*cos(p1);
        // wave 2
        float p2 = (0.6*wp.x + 0.8*wp.y)*0.30 + uTime*1.3;
        h += 0.09*sin(p2); dhx += 0.09*0.30*0.6*cos(p2); dhz += 0.09*0.30*0.8*cos(p2);
        // wave 3
        float p3 = (-0.8*wp.x + 0.5*wp.y)*0.55 + uTime*1.8;
        h += 0.045*sin(p3); dhx += 0.045*0.55*(-0.8)*cos(p3); dhz += 0.045*0.55*0.5*cos(p3);
        // wave 4 (fine chop)
        float p4 = (0.25*wp.x - 0.97*wp.y)*0.95 + uTime*2.5;
        h += 0.022*sin(p4); dhx += 0.022*0.95*0.25*cos(p4); dhz += 0.022*0.95*(-0.97)*cos(p4);
        pos.y += h;
        vNormal = normalize(vec3(-dhx, 1.0, -dhz));
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uCam;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(uCam - vWorldPos);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 deep = vec3(0.02, 0.16, 0.25);
        vec3 shallow = vec3(0.10, 0.38, 0.47);
        vec3 base = mix(deep, shallow, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
        vec3 sky = vec3(0.62, 0.80, 0.90);
        vec3 col = mix(base, sky, fres * 0.6);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 140.0);
        col += vec3(1.0, 0.96, 0.82) * spec * 0.9;
        // distance fade toward fog colour for a soft horizon
        float d = length(uCam - vWorldPos);
        col = mix(col, vec3(0.74, 0.85, 0.91), clamp((d - 90.0) / 240.0, 0.0, 0.85));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 0;
  return {
    mesh,
    material,
    update(time, cx, cz) {
      mesh.position.set(cx, 0, cz);
      material.uniforms.uTime.value = time;
      material.uniforms.uOffset.value.set(cx, cz);
    },
  };
}

function makeSky() {
  const geo = new THREE.SphereGeometry(900, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#3f7fb8') },
      bottom: { value: new THREE.Color('#cfe4ef') },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 top; uniform vec3 bottom;
      void main() {
        float t = clamp(vP.y / 900.0 * 0.5 + 0.4, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

// ---------------- Player boat ----------------

function makeBoat() {
  const group = new THREE.Group();

  // Hull from the top-down outline, extruded for freeboard.
  const shape = new THREE.Shape();
  const hw = 1.1; // half-width
  shape.moveTo(3.0, 0);
  shape.quadraticCurveTo(2.7, hw, 1.3, hw);
  shape.lineTo(-3.0, hw * 0.85);
  shape.lineTo(-3.0, -hw * 0.85);
  shape.lineTo(1.3, -hw);
  shape.quadraticCurveTo(2.7, -hw, 3.0, 0);
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.85, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color: '#eef2f7', roughness: 0.55, metalness: 0.05 })
  );
  hull.rotation.x = -Math.PI / 2;          // lay flat (deck up)
  hull.position.y = 0.18;                   // waterline
  group.add(hull);

  // Dark interior (cockpit well) sunk into the deck.
  const well = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.4, 1.6),
    new THREE.MeshStandardMaterial({ color: '#1d364f', roughness: 0.8 })
  );
  well.position.set(-0.6, 0.62, 0);
  group.add(well);

  // Bow foredeck — a raised wedge that fills the lower view in cockpit mode.
  const fore = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.4, 1.9),
    new THREE.MeshStandardMaterial({ color: '#dfe6ee', roughness: 0.5 })
  );
  fore.position.set(1.7, 0.72, 0);
  group.add(fore);

  // Windshield frame + glass at the cockpit front.
  const wsFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.55, 1.9),
    new THREE.MeshStandardMaterial({ color: '#1a2735', roughness: 0.4, metalness: 0.3 })
  );
  wsFrame.position.set(0.55, 1.05, 0);
  wsFrame.rotation.z = 0.28;
  group.add(wsFrame);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.5, 1.8),
    new THREE.MeshStandardMaterial({ color: '#9ccfe6', transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1 })
  );
  glass.position.set(0.55, 1.05, 0);
  glass.rotation.z = 0.28;
  group.add(glass);

  // Helm console + a small wheel (also visible in cockpit just below view).
  const console3d = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.7),
    new THREE.MeshStandardMaterial({ color: '#12202e', roughness: 0.6 })
  );
  console3d.position.set(0.0, 0.95, -0.45);
  group.add(console3d);
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.035, 10, 24),
    new THREE.MeshStandardMaterial({ color: '#caa15a', roughness: 0.5, metalness: 0.3 })
  );
  wheel.position.set(0.18, 1.15, -0.45);
  wheel.rotation.y = Math.PI / 2;
  group.add(wheel);

  // Two seats.
  for (const z of [-0.45, 0.45]) {
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.18, 0.5),
      new THREE.MeshStandardMaterial({ color: '#41506a', roughness: 0.8 })
    );
    seat.position.set(-0.5, 0.85, z);
    group.add(seat);
  }

  // Outboard at the transom (swivels with the rudder).
  const motor = new THREE.Group();
  const cowl = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.4),
    new THREE.MeshStandardMaterial({ color: '#161d28', roughness: 0.5 })
  );
  cowl.position.set(-0.25, 0.55, 0);
  motor.add(cowl);
  motor.position.set(-3.0, 0, 0);
  group.add(motor);

  return {
    group,
    update(b) {
      motor.rotation.y = -b.rudder * 0.5;
      wheel.rotation.x = b.rudderTarget * 2.2;
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
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(e.length, 0.3, e.width),
      new THREE.MeshStandardMaterial({ color: '#8a6a40', roughness: 0.85 })
    );
    deck.position.y = 0.22;
    group.add(deck);
    // Pontoon floats below the deck so it visibly rides on the surface.
    const floatMat = new THREE.MeshStandardMaterial({ color: '#3a4654', roughness: 0.7 });
    for (const sz of [-1, 1]) {
      const pon = new THREE.Mesh(
        new THREE.BoxGeometry(e.length * 0.96, 0.22, e.width * 0.32),
        floatMat
      );
      pon.position.set(0, 0.0, sz * (e.width * 0.3));
      group.add(pon);
    }
    // Float a touch above the waterline; baseY lifts the deck clear of the chop.
    return { group, baseY: 0.18, floats: true };
  }

  if (e.category === 'buoy') {
    const color = BUOY_COLORS3D[e.presetId] || '#e8c33a';
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(e.length * 0.5, 16, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    body.position.y = e.length * 0.35;
    group.add(body);
    const topMark = new THREE.Mesh(
      new THREE.ConeGeometry(e.length * 0.28, e.length * 0.5, 10),
      new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.6 })
    );
    topMark.position.y = e.length * 0.9;
    group.add(topMark);
    return { group, baseY: 0, floats: true };
  }

  // Parked boat — simplified hull + cabin, light hull colour.
  const shape = new THREE.Shape();
  const hw = e.width * 0.5;
  const hl = e.length * 0.5;
  shape.moveTo(hl, 0);
  shape.quadraticCurveTo(hl * 0.9, hw, hl * 0.3, hw);
  shape.lineTo(-hl, hw * 0.8);
  shape.lineTo(-hl, -hw * 0.8);
  shape.lineTo(hl * 0.3, -hw);
  shape.quadraticCurveTo(hl * 0.9, -hw, hl, 0);
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1 }),
    new THREE.MeshStandardMaterial({ color: '#e6ebf1', roughness: 0.6 })
  );
  hull.rotation.x = -Math.PI / 2;
  hull.position.y = 0.16;
  group.add(hull);
  if (e.cabin) {
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(e.length * 0.4, 0.7, e.width * 0.7),
      new THREE.MeshStandardMaterial({ color: '#f4f8fb', roughness: 0.5 })
    );
    cabin.position.set(e.length * 0.05, 0.9, 0);
    group.add(cabin);
  } else {
    const interior = new THREE.Mesh(
      new THREE.BoxGeometry(e.length * 0.55, 0.35, e.width * 0.6),
      new THREE.MeshStandardMaterial({ color: '#2c4760', roughness: 0.8 })
    );
    interior.position.set(-e.length * 0.08, 0.55, 0);
    group.add(interior);
  }
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
