import { createBoat } from './physics.js';
import { WAKE_EMIT_INTERVAL, WAKE_LIFETIME, WAKE_MAX_POINTS } from './constants.js';

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
