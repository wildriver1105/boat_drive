import {
  MASS,
  I_Z,
  THRUST_MAX,
  THRUST_REVERSE_SCALE,
  DRAG_FWD_LIN,
  DRAG_FWD_QUAD,
  HULL_DRAG_ARM,
  DRAG_LAT_LIN_PER_POINT,
  DRAG_LAT_QUAD_PER_POINT,
  RUDDER_ARM,
  RUDDER_LIFT,
  THROTTLE_RAMP_RATE,
  RUDDER_RAMP_RATE,
  THROTTLE_RATE,
  RUDDER_RATE,
} from './constants.js';

export function createBoat(x = 0, y = 0, heading = 0) {
  return {
    x, y, heading,
    vx: 0, vy: 0,
    omega: 0,
    // Engine throttle: target is "sticky", actual smooths toward it (engine response).
    throttleTarget: 0,
    throttle: 0,
    // Rudder helm: target is auto-return (set by key state), actual smooths toward it.
    rudderTarget: 0,
    rudder: 0,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerpTowards(current, target, rate, dt) {
  const diff = target - current;
  const maxStep = rate * dt;
  if (diff > maxStep) return current + maxStep;
  if (diff < -maxStep) return current - maxStep;
  return target;
}

function updateTargetsFromKeys(boat, keys, dt) {
  // Throttle — STICKY: ramps while held, stays on release. Only Space resets.
  // While the mouse is dragging the throttle handle, ignore W/S so the two
  // input sources don't fight each other (mouse writes directly to target).
  if (keys.neutral) {
    boat.throttleTarget = 0;
  } else if (!keys.mouseDraggingThrottle) {
    let rate = 0;
    if (keys.throttleUp) rate += THROTTLE_RAMP_RATE;
    if (keys.throttleDown) rate -= THROTTLE_RAMP_RATE;
    boat.throttleTarget = clamp(boat.throttleTarget + rate * dt, -1, 1);
  }

  // Rudder — STICKY: A/D ramp the target while held, stays on release.
  // Mouse drag on the helm wheel writes the target directly (suppresses
  // key ramping for the helm while the mouse owns it).
  if (keys.neutral) {
    boat.rudderTarget = 0;
  } else if (!keys.mouseDraggingHelm) {
    let rRate = 0;
    if (keys.rudderLeft) rRate -= RUDDER_RAMP_RATE;
    if (keys.rudderRight) rRate += RUDDER_RAMP_RATE;
    boat.rudderTarget = clamp(boat.rudderTarget + rRate * dt, -1, 1);
  }
}

// Advance the boat one fixed step.
export function stepBoat(boat, keys, dt) {
  updateTargetsFromKeys(boat, keys, dt);

  // Engine response & helm response (smooth toward targets).
  boat.throttle = lerpTowards(boat.throttle, boat.throttleTarget, THROTTLE_RATE, dt);
  boat.rudder = lerpTowards(boat.rudder, boat.rudderTarget, RUDDER_RATE, dt);

  // World velocity → hull-local (forward / lateral) frame.
  const cosH = Math.cos(boat.heading);
  const sinH = Math.sin(boat.heading);
  const vFwd = boat.vx * cosH + boat.vy * sinH;
  const vLat = -boat.vx * sinH + boat.vy * cosH;

  // Lateral velocity at the bow and stern drag points. A body-fixed point at
  // body-frame (x_b, 0) has body-frame velocity (vFwd, vLat + ω·x_b). The
  // bow swings opposite to the stern when the boat yaws — this is the
  // mechanism that gives realistic bow/stern differential motion.
  const vL_bow = vLat + boat.omega * HULL_DRAG_ARM;
  const vL_stern = vLat - boat.omega * HULL_DRAG_ARM;

  // Lateral hull drag at each point (linear + quadratic).
  const F_lat_bow =
    -DRAG_LAT_LIN_PER_POINT * vL_bow -
    DRAG_LAT_QUAD_PER_POINT * vL_bow * Math.abs(vL_bow);
  const F_lat_stern =
    -DRAG_LAT_LIN_PER_POINT * vL_stern -
    DRAG_LAT_QUAD_PER_POINT * vL_stern * Math.abs(vL_stern);

  // Engine thrust along forward axis. Reverse is weaker than forward.
  const thrustScale = boat.throttle >= 0 ? 1 : THRUST_REVERSE_SCALE;
  const F_thrust = boat.throttle * THRUST_MAX * thrustScale;

  // Forward drag at CG.
  const F_drag_fwd =
    -DRAG_FWD_LIN * vFwd - DRAG_FWD_QUAD * vFwd * Math.abs(vFwd);

  // Rudder lift force, applied at the stern (x = -RUDDER_ARM), perpendicular
  // to the hull. Magnitude ∝ vFwd² with sign from vFwd·|vFwd| so reversing
  // flips the side the stern is kicked toward — exactly like a real boat.
  const F_rudder = -RUDDER_LIFT * boat.rudder * vFwd * Math.abs(vFwd);

  // Sum of body-frame forces.
  const F_body_x = F_thrust + F_drag_fwd;
  const F_body_y = F_lat_bow + F_lat_stern + F_rudder;

  // Torque about CG: τ = Σ x_b · F_y for each lateral force at (x_b, 0).
  const tau =
    HULL_DRAG_ARM * F_lat_bow +
    -HULL_DRAG_ARM * F_lat_stern +
    -RUDDER_ARM * F_rudder;

  // Body → world acceleration.
  const ax = (F_body_x * cosH - F_body_y * sinH) / MASS;
  const ay = (F_body_x * sinH + F_body_y * cosH) / MASS;
  const alpha = tau / I_Z;

  // Semi-implicit Euler.
  boat.vx += ax * dt;
  boat.vy += ay * dt;
  boat.omega += alpha * dt;

  boat.x += boat.vx * dt;
  boat.y += boat.vy * dt;
  boat.heading += boat.omega * dt;

  if (boat.heading > Math.PI) boat.heading -= 2 * Math.PI;
  else if (boat.heading <= -Math.PI) boat.heading += 2 * Math.PI;
}

// Diagnostic helpers used by the renderer (HUD / pivot dot).
export function boatSpeed(boat) {
  return Math.hypot(boat.vx, boat.vy);
}

// Instantaneous "lateral pivot point" of the hull in body-frame x.
// This is the point along the centerline whose lateral velocity (vLat + ω·x)
// is zero — i.e. the point about which the hull is instantaneously rotating
// in the lateral sense. Returns null when the boat is barely yawing.
export function lateralPivotBodyX(boat) {
  if (Math.abs(boat.omega) < 0.04) return null;
  const cosH = Math.cos(boat.heading);
  const sinH = Math.sin(boat.heading);
  const vLat = -boat.vx * sinH + boat.vy * cosH;
  return -vLat / boat.omega;
}
