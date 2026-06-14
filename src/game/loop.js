import { stepBoat } from './physics.js';
import { updateTrails, updateWindStreaks, updateTrack, saveWorld } from './world.js';
import { stepEntities, resolveCollisions, guardDynamics } from './collisions.js';
import { FIXED_DT, MAX_STEPS_PER_FRAME } from './constants.js';

const EDIT_PAN_SPEED = 28; // m/s — how fast WASD pans the camera when editing
const AUTOSAVE_DEBOUNCE = 2; // s — persist pushed-around entities after things settle

// Drives the simulation with a fixed-dt accumulator so the physics is
// deterministic regardless of frame rate. Rendering happens once per
// animation frame using the latest state.
export function createLoop({ world, input, render }) {
  let rafId = null;
  let lastTs = 0;
  let accumulator = 0;
  let running = false;
  let entitiesDirty = false;
  let saveTimer = 0;

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
      if (world.edit.mode) {
        // Edit mode: physics paused. WASD/arrows pan the camera.
        panEditCamera(world, keys, FIXED_DT);
      } else {
        stepBoat(world.boat, keys, world.wind, FIXED_DT);
        // Pushed entities keep drifting; then settle all contacts (boat ↔
        // entity, entity ↔ entity; docks are immovable).
        const moved = stepEntities(world, FIXED_DT);
        const touched = resolveCollisions(world);
        // NaN watchdog — recover instead of freezing on a corrupted state.
        guardDynamics(world);
        if (moved || touched) entitiesDirty = true;
        // Tracking mode records the racing line while driving.
        updateTrack(world, FIXED_DT);
        // Drive mode: camera glues to the boat each step.
        world.camera.x = world.boat.x;
        world.camera.y = world.boat.y;
      }
      // Ambient updates run in both modes so the water / wind keep alive.
      updateTrails(world, FIXED_DT);
      updateWindStreaks(world, FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;

    // Debounced autosave so shoved boats keep their new positions across
    // reloads without hammering localStorage every frame.
    if (entitiesDirty) {
      saveTimer += dt;
      if (saveTimer >= AUTOSAVE_DEBOUNCE) {
        saveWorld(world);
        entitiesDirty = false;
        saveTimer = 0;
      }
    } else {
      saveTimer = 0;
    }

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

function panEditCamera(world, keys, dt) {
  // Reuse the throttle / rudder key state so the same WASD/arrows pan in
  // edit mode. W/↑ = up, S/↓ = down, A/← = left, D/→ = right.
  let dx = 0;
  let dy = 0;
  if (keys.throttleUp) dy -= 1;
  if (keys.throttleDown) dy += 1;
  if (keys.rudderLeft) dx -= 1;
  if (keys.rudderRight) dx += 1;
  if (dx !== 0 || dy !== 0) {
    const inv = 1 / Math.hypot(dx, dy);
    world.camera.x += dx * inv * EDIT_PAN_SPEED * dt;
    world.camera.y += dy * inv * EDIT_PAN_SPEED * dt;
  }
}
