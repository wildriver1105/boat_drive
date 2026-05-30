import { createBoat } from './physics.js';
import {
  WAKE_EMIT_INTERVAL,
  WAKE_LIFETIME,
  WAKE_MAX_POINTS,
  WIND_STREAK_MAX,
  WIND_STREAK_LIFETIME,
  WIND_STREAK_SPAWN_RADIUS_M,
  WIND_STREAK_THRESHOLD,
  WIND_STREAK_FULL_SPEED,
  WIND_STREAK_LEN_M,
} from './constants.js';

export function createWorld() {
  return {
    boat: createBoat(0, 0, -Math.PI / 2), // start pointing "up" on screen (−y)
    entities: [], // future: buoys, markers, race gates, etc.
    wake: [],
    wakeAccumulator: 0,
    time: 0,
    // Environment — configured at runtime via the Settings modal.
    // fromBearing is METEOROLOGICAL: the compass bearing the wind COMES FROM.
    // 0 = wind from north (blowing south); 90 = from east; etc.
    wind: {
      speed: 0,        // m/s
      fromBearing: 0,  // radians (compass bearing converted to radians)
    },
    // Drifting visual streaks that show the wind on the water.
    windStreaks: [],
    windStreakSpawnAccum: 0,
  };
}

// Called from the loop after each fixed physics step.
// Emits wake points behind the boat and ages out old ones.
export function updateTrails(world, dt) {
  world.time += dt;
  world.wakeAccumulator += dt;

  const speed = Math.hypot(world.boat.vx, world.boat.vy);
  if (world.wakeAccumulator >= WAKE_EMIT_INTERVAL && speed > 0.4) {
    world.wakeAccumulator = 0;
    const b = world.boat;
    // Emit at the stern (a couple of meters behind the boat center).
    const sx = b.x - Math.cos(b.heading) * 2.5;
    const sy = b.y - Math.sin(b.heading) * 2.5;
    world.wake.push({ x: sx, y: sy, born: world.time });
    if (world.wake.length > WAKE_MAX_POINTS) {
      world.wake.splice(0, world.wake.length - WAKE_MAX_POINTS);
    }
  }

  // Drop expired wake points.
  const cutoff = world.time - WAKE_LIFETIME;
  while (world.wake.length && world.wake[0].born < cutoff) {
    world.wake.shift();
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
  const x = world.boat.x + biasX + (Math.random() * 2 - 1) * r;
  const y = world.boat.y + biasY + (Math.random() * 2 - 1) * r;

  world.windStreaks.push({
    x,
    y,
    born: world.time,
    lifetime: WIND_STREAK_LIFETIME * (0.8 + Math.random() * 0.4),
    length: WIND_STREAK_LEN_M * (0.75 + Math.random() * 0.5),
  });
}
