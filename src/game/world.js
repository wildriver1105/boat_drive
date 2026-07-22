import { createBoat } from './physics.js';
import { reseedFromEntities } from './entities.js';
import {
  WAKE_EMIT_INTERVAL,
  WAKE_MAX_POINTS,
  THROTTLE_NEUTRAL_BAND,
  WIND_STREAK_MAX,
  WIND_STREAK_LIFETIME,
  WIND_STREAK_SPAWN_RADIUS_M,
  WIND_STREAK_THRESHOLD,
  WIND_STREAK_FULL_SPEED,
  WIND_STREAK_LEN_M,
} from './constants.js';

const STORAGE_KEY = 'boat_drive.map.v1';

export function createWorld() {
  const persisted = loadPersisted();
  const entities = sanitizeEntities(persisted.entities);
  reseedFromEntities(entities);

  return {
    boat: createBoat(0, 0, -Math.PI / 2), // start pointing "up" on screen (−y)
    entities,
    wake: [],
    wakeAccumulator: 0,
    time: 0,
    // Environment — configured at runtime via the Settings modal.
    wind: {
      speed: 0,
      fromBearing: 0,
    },
    windStreaks: [],
    windStreakSpawnAccum: 0,
    // Camera: world-space anchor that the renderer centers on. In drive
    // mode it tracks the boat; in edit mode the user pans it freely.
    camera: { x: 0, y: 0 },
    // Map-editor state. `mode` toggles between drive and edit; when in
    // edit mode the boat physics is paused and mouse / keyboard input is
    // routed to the editor instead of the throttle / helm.
    edit: {
      mode: false,
      tool: 'select',          // 'select' or one of ENTITY_PRESETS[].id
      selectedId: null,
      dragging: false,
      dragOffset: { x: 0, y: 0 },
      // World position under the mouse while idle in edit mode — anchors
      // the translucent placement preview. Null when not applicable.
      hover: null,
      // In-progress drag-to-size terrain placement:
      // { presetId, x0, y0, x1, y1 } (world coords) or null.
      sizing: null,
      // In-progress terrain vertex drag: { id, index } or null.
      vertexDrag: null,
      // 3D edit camera distance (zoomed with - / =).
      camDist: 40,
      dirty: false,
    },
    // Tracking mode — records the boat's racing line for F1-style review:
    //   path   = a dense, continuous polyline of where the hull went
    //   ghosts = a snapshot of the boat's POSE (position + heading) every
    //            `intervalS` seconds, so you can see how the hull was angled
    //            (a drifting boat slides its stern out — the silhouette
    //            orientation differs from the path direction).
    track: {
      on: false,
      intervalS: 1.0,
      path: [],
      ghosts: [],
      pathLast: null,
      ghostAccum: 0,
    },
    // Mooring lines — ropes from the boat's cleats to docks / bollards.
    // `mode` enables the drag-to-connect interaction (top-down only).
    // `drag` holds an in-progress new line being dragged from a cleat.
    mooring: {
      mode: false,
      lines: [],
      drag: null,
      nextId: 1,
    },
  };
}

function loadPersisted() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {};
}

export function saveWorld(world) {
  if (typeof localStorage === 'undefined') return;
  try {
    // Whitelist persisted fields — pose and identity only. Transient
    // dynamics (vx/vy/omega, watchdog snapshots, …) never reach storage,
    // and a corrupted pose is dropped rather than written.
    const entities = sanitizeEntities(world.entities).map((e) => ({
      id: e.id,
      presetId: e.presetId,
      category: e.category,
      x: e.x,
      y: e.y,
      heading: e.heading,
      length: e.length,
      width: e.width,
      hull: e.hull,
      sail: e.sail,
      cabin: e.cabin,
      beacon: e.beacon,
      mark: e.mark,
      aid: e.aid,
      terrain: e.terrain,
      height: e.height,
      poly: e.poly,
    }));
    const data = { entities };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    world.edit.dirty = false;
  } catch (e) { /* ignore */ }
}

// Records the boat's track while tracking mode is on. Path points are
// distance-sampled (continuous line); ghost poses are time-sampled at the
// configured interval. Called from the loop in drive mode only.
const TRACK_PATH_STEP_M = 0.4;   // min spacing between path points
const TRACK_MAX_PATH = 8000;     // rolling cap
const TRACK_MAX_GHOSTS = 600;

export function updateTrack(world, dt) {
  const tr = world.track;
  if (!tr || !tr.on) return;
  const b = world.boat;
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return;

  // Continuous path — add a point whenever the hull has moved far enough.
  const last = tr.pathLast;
  if (!last || Math.hypot(b.x - last.x, b.y - last.y) >= TRACK_PATH_STEP_M) {
    tr.path.push({ x: b.x, y: b.y });
    tr.pathLast = { x: b.x, y: b.y };
    if (tr.path.length > TRACK_MAX_PATH) tr.path.shift();
  }

  // Pose snapshots — sampled on the interval clock.
  tr.ghostAccum += dt;
  if (tr.ghostAccum >= tr.intervalS) {
    tr.ghostAccum -= tr.intervalS;
    tr.ghosts.push({ x: b.x, y: b.y, heading: b.heading, t: world.time });
    if (tr.ghosts.length > TRACK_MAX_GHOSTS) tr.ghosts.shift();
  }
}

export function clearTrack(world) {
  const tr = world.track;
  tr.path.length = 0;
  tr.ghosts.length = 0;
  tr.pathLast = null;
  tr.ghostAccum = 0;
}

// Drop entities whose pose or footprint is not a finite number — protects
// against maps that were saved while the simulation was corrupted (NaN
// serializes to null in JSON) and against hand-edited storage.
function sanitizeEntities(list) {
  if (!Array.isArray(list)) return [];
  const ok = list.filter(
    (e) =>
      e &&
      typeof e === 'object' &&
      Number.isFinite(e.x) &&
      Number.isFinite(e.y) &&
      Number.isFinite(e.heading) &&
      Number.isFinite(e.length) && e.length > 0 &&
      Number.isFinite(e.width) && e.width > 0
  );
  // A corrupt polygon degrades to the procedural outline instead of
  // poisoning the renderers / collision solver.
  for (const e of ok) {
    if (e.poly !== undefined) {
      const valid =
        Array.isArray(e.poly) &&
        e.poly.length >= 3 &&
        e.poly.every(
          (v) => Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
        );
      if (!valid) delete e.poly;
    }
  }
  return ok;
}

// Called from the loop after each fixed physics step. Maintains the wake
// particle system: every particle is a textured foam blob sitting in the
// water with its own velocity, growth and lifetime. The combination of
// emitters below produces the full wake picture:
//   • stern foam   — turbulent centre trail behind a moving hull
//   • Kelvin arms  — paired particles drifting laterally outward, so the
//                    trail widens into the classic V shape over time
//   • prop wash    — churn behind the motor whenever the clutch is engaged,
//                    even at zero boat speed (essential docking feedback)
//   • bow spray    — small splashes peeling off the bow shoulders at speed
export function updateTrails(world, dt) {
  world.time += dt;
  const b = world.boat;
  const speed = Math.hypot(b.vx, b.vy);
  const cosH = Math.cos(b.heading);
  const sinH = Math.sin(b.heading);

  world.wakeAccumulator += dt;
  if (world.wakeAccumulator >= WAKE_EMIT_INTERVAL) {
    world.wakeAccumulator = 0;
    emitWakeParticles(world, b, speed, cosH, sinH);
  }

  // Advance particles; water friction bleeds their velocity away.
  const damp = Math.exp(-1.6 * dt);
  const t = world.time;
  for (let i = world.wake.length - 1; i >= 0; i--) {
    const p = world.wake[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= damp;
    p.vy *= damp;
    if (t - p.born >= p.lifetime) world.wake.splice(i, 1);
  }
  if (world.wake.length > WAKE_MAX_POINTS) {
    world.wake.splice(0, world.wake.length - WAKE_MAX_POINTS);
  }
}

function emitWakeParticles(world, b, speed, cosH, sinH) {
  const t = world.time;
  // Lateral unit vector (body +y = starboard) in world coords.
  const latX = -sinH;
  const latY = cosH;

  // Stern foam + Kelvin V arms while the hull is moving through water.
  if (speed > 0.6) {
    const sx = b.x - cosH * 2.4;
    const sy = b.y - sinH * 2.4;
    world.wake.push({
      x: sx + (Math.random() - 0.5) * 0.8,
      y: sy + (Math.random() - 0.5) * 0.8,
      vx: latX * (Math.random() - 0.5) * 0.6,
      vy: latY * (Math.random() - 0.5) * 0.6,
      born: t,
      lifetime: 2.2 + Math.random() * 1.4,
      size0: 0.9 + speed * 0.07,
      grow: 1.1 + Math.random() * 0.8,
      alpha: Math.min(0.6, 0.22 + speed * 0.05),
    });
    // V arms: lateral drift makes the trail widen into a wake fan.
    const armSpeed = 0.45 + speed * 0.06;
    for (const side of [-1, 1]) {
      world.wake.push({
        x: sx,
        y: sy,
        vx: latX * armSpeed * side,
        vy: latY * armSpeed * side,
        born: t,
        lifetime: 1.8 + Math.random() * 0.9,
        size0: 0.5,
        grow: 0.8,
        alpha: Math.min(0.38, 0.12 + speed * 0.04),
      });
    }
  }

  // Bow spray at planing-ish speeds.
  if (speed > 3.5) {
    const bx = b.x + cosH * 2.6;
    const by = b.y + sinH * 2.6;
    for (const side of [-1, 1]) {
      if (Math.random() < 0.75) {
        world.wake.push({
          x: bx + latX * side * 0.9,
          y: by + latY * side * 0.9,
          vx: latX * side * (0.8 + speed * 0.12) + b.vx * 0.25,
          vy: latY * side * (0.8 + speed * 0.12) + b.vy * 0.25,
          born: t,
          lifetime: 0.5 + Math.random() * 0.4,
          size0: 0.35,
          grow: 1.4,
          alpha: Math.min(0.5, 0.1 + speed * 0.05),
        });
      }
    }
  }

  // Thruster wash — water jets out the side OPPOSITE the push, at the bow
  // or stern tunnel. Visible even at rest, which is exactly when thrusters
  // are used.
  for (const [val, armX] of [
    [b.bowThruster || 0, 2.4],
    [b.sternThruster || 0, -2.4],
  ]) {
    if (Math.abs(val) > 0.25) {
      const px = b.x + cosH * armX;
      const py = b.y + sinH * armX;
      const jet = -Math.sign(val); // hull pushed one way → jet exits the other
      world.wake.push({
        x: px + latX * jet * 1.2,
        y: py + latY * jet * 1.2,
        vx: latX * jet * (1.2 + Math.random() * 0.8),
        vy: latY * jet * (1.2 + Math.random() * 0.8),
        born: t,
        lifetime: 0.5 + Math.random() * 0.4,
        size0: 0.35,
        grow: 1.4,
        alpha: 0.4 * Math.abs(val),
      });
    }
  }

  // Prop wash — fires whenever the gearbox is engaged, including at rest.
  if (Math.abs(b.throttle) > THROTTLE_NEUTRAL_BAND) {
    const px = b.x - cosH * 3.1;
    const py = b.y - sinH * 3.1;
    const dir = b.throttle > 0 ? -1 : 1; // thrust forward → wash aft
    world.wake.push({
      x: px + (Math.random() - 0.5) * 0.5,
      y: py + (Math.random() - 0.5) * 0.5,
      vx: cosH * dir * (1.5 + Math.random()) + latX * (Math.random() - 0.5) * 0.8,
      vy: sinH * dir * (1.5 + Math.random()) + latY * (Math.random() - 0.5) * 0.8,
      born: t,
      lifetime: 0.7 + Math.random() * 0.5,
      size0: 0.5,
      grow: 2.0,
      alpha: 0.45 * Math.min(1, Math.abs(b.throttle) + 0.25),
    });
  }
}

// Ambient wind streak particles (drift on the water surface). Density ramps
// up smoothly from WIND_STREAK_THRESHOLD to WIND_STREAK_FULL_SPEED; existing
// streaks always finish their life so changes look like a fade rather than
// a hard cut.
export function updateWindStreaks(world, dt) {
  const wind = world.wind;

  // Density target as a function of wind strength.
  let windFactor = 0;
  if (wind && wind.speed > WIND_STREAK_THRESHOLD) {
    windFactor = Math.min(
      1,
      (wind.speed - WIND_STREAK_THRESHOLD) /
        (WIND_STREAK_FULL_SPEED - WIND_STREAK_THRESHOLD)
    );
  }
  const targetCount = WIND_STREAK_MAX * windFactor;

  // Spawn rate that maintains the target average count given the lifetime.
  if (targetCount > 0) {
    const spawnRate = targetCount / WIND_STREAK_LIFETIME;
    world.windStreakSpawnAccum += spawnRate * dt;
    while (world.windStreakSpawnAccum >= 1) {
      world.windStreakSpawnAccum -= 1;
      spawnWindStreak(world);
    }
  } else {
    world.windStreakSpawnAccum = 0;
  }

  // Advance live streaks with the wind. Same world-frame velocity as the
  // wind force model in physics.js so what you see matches what you feel.
  if (wind && wind.speed > 0) {
    const windVx = -Math.sin(wind.fromBearing) * wind.speed;
    const windVy = Math.cos(wind.fromBearing) * wind.speed;
    for (const s of world.windStreaks) {
      s.x += windVx * dt;
      s.y += windVy * dt;
    }
  }

  // Drop expired streaks.
  const t = world.time;
  for (let i = world.windStreaks.length - 1; i >= 0; i--) {
    const s = world.windStreaks[i];
    if (t - s.born >= s.lifetime) {
      world.windStreaks.splice(i, 1);
    }
  }
}

function spawnWindStreak(world) {
  const r = WIND_STREAK_SPAWN_RADIUS_M;
  // Uniform within a square centered on the boat (the camera). Slightly
  // bias the spawn toward the UPWIND side so streaks usually appear from
  // upwind and travel across the screen — visually the "wind arriving".
  const wind = world.wind;
  let biasX = 0;
  let biasY = 0;
  if (wind && wind.speed > 0) {
    // Upwind direction = where wind comes FROM, in canvas frame.
    biasX = Math.sin(wind.fromBearing) * r * 0.35;
    biasY = -Math.cos(wind.fromBearing) * r * 0.35;
  }
  const x = world.camera.x + biasX + (Math.random() * 2 - 1) * r;
  const y = world.camera.y + biasY + (Math.random() * 2 - 1) * r;

  world.windStreaks.push({
    x,
    y,
    born: world.time,
    lifetime: WIND_STREAK_LIFETIME * (0.8 + Math.random() * 0.4),
    length: WIND_STREAK_LEN_M * (0.75 + Math.random() * 0.5),
  });
}
