import {
  MASS,
  I_Z,
  THRUST_MAX,
  THRUST_REVERSE_SCALE,
  DRAG_FWD_LIN,
  DRAG_FWD_QUAD,
  DRAG_LAT_LIN,
  DRAG_LAT_QUAD,
  RUDDER_GAIN,
  YAW_DAMP_LIN,
  YAW_DAMP_QUAD,
  THROTTLE_RATE,
  RUDDER_RATE,
} from './constants.js';

export function createBoat(x = 0, y = 0, heading = 0) {
  return {
    x, y, heading,
    vx: 0, vy: 0,
    omega: 0,
    throttle: 0,
    rudder: 0,
  };
}

// Move `current` toward `target` at `rate` per second.
function lerpTowards(current, target, rate, dt) {
  const diff = target - current;
  const maxStep = rate * dt;
  if (diff > maxStep) return current + maxStep;
  if (diff < -maxStep) return current - maxStep;
  return target;
}

// Advance the boat one fixed step.
// targets: { throttle: -1..1, rudder: -1..1 }
export function stepBoat(boat, targets, dt) {
  // Smooth inputs toward targets — gives the helm a bit of "wheel weight".
  boat.throttle = lerpTowards(boat.throttle, targets.throttle, THROTTLE_RATE, dt);
  boat.rudder = lerpTowards(boat.rudder, targets.rudder, RUDDER_RATE, dt);

  const cosH = Math.cos(boat.heading);
  const sinH = Math.sin(boat.heading);

  // World velocity → hull-local frame (forward / lateral).
  const forward = boat.vx * cosH + boat.vy * sinH;
  const lateral = -boat.vx * sinH + boat.vy * cosH;

  // Thrust along forward axis. Reverse is weaker than forward.
  const thrustScale = boat.throttle >= 0 ? 1 : THRUST_REVERSE_SCALE;
  const fThrust = boat.throttle * THRUST_MAX * thrustScale;

  // Hydrodynamic drag (asymmetric: hull resists sideways motion much more).
  const fDragFwd =
    -DRAG_FWD_LIN * forward - DRAG_FWD_QUAD * forward * Math.abs(forward);
  const fDragLat =
    -DRAG_LAT_LIN * lateral - DRAG_LAT_QUAD * lateral * Math.abs(lateral);

  // Net local forces → world acceleration.
  const fLocalFwd = fThrust + fDragFwd;
  const fLocalLat = fDragLat;
  const ax = (fLocalFwd * cosH - fLocalLat * sinH) / MASS;
  const ay = (fLocalFwd * sinH + fLocalLat * cosH) / MASS;

  // Rudder torque depends on water flow over the rudder, i.e. forward speed.
  // Reversing flips the sign naturally (forward < 0 → opposite yaw direction).
  const tauRudder = boat.rudder * RUDDER_GAIN * forward;
  const tauDamp =
    -YAW_DAMP_LIN * boat.omega - YAW_DAMP_QUAD * boat.omega * Math.abs(boat.omega);
  const alpha = (tauRudder + tauDamp) / I_Z;

  // Semi-implicit Euler: update velocities first, then positions.
  boat.vx += ax * dt;
  boat.vy += ay * dt;
  boat.omega += alpha * dt;

  boat.x += boat.vx * dt;
  boat.y += boat.vy * dt;
  boat.heading += boat.omega * dt;

  // Keep heading in (-π, π] to avoid unbounded growth.
  if (boat.heading > Math.PI) boat.heading -= 2 * Math.PI;
  else if (boat.heading <= -Math.PI) boat.heading += 2 * Math.PI;
}

// Convenience: speed magnitude in m/s
export function boatSpeed(boat) {
  return Math.hypot(boat.vx, boat.vy);
}
