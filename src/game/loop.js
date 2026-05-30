import { stepBoat } from './physics.js';
import { updateTrails } from './world.js';
import { FIXED_DT, MAX_STEPS_PER_FRAME } from './constants.js';

// Drives the simulation with a fixed-dt accumulator so the physics is
// deterministic regardless of frame rate. Rendering happens once per
// animation frame using the latest state.
export function createLoop({ world, input, render }) {
  let rafId = null;
  let lastTs = 0;
  let accumulator = 0;
  let running = false;

  function frame(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.25) dt = 0.25; // tab-switch protection
    accumulator += dt;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const keys = input.getKeys();
      stepBoat(world.boat, keys, world.wind, FIXED_DT);
      updateTrails(world, FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;

    render(world);
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTs = 0;
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}
