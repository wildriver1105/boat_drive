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
  WIND_COEF,
  WIND_ARM,
  THROTTLE_NEUTRAL_BAND,
  THROTTLE_CATCH_PULSE_TIME,
  BOW_THRUSTER_FORCE,
  STERN_THRUSTER_FORCE,
  THRUSTER_BOW_ARM,
  THRUSTER_STERN_ARM,
  THRUSTER_RATE,
  THRUSTER_SPEED_FALLOFF,
  PROP_WALK_FORCE,
  PROP_WALK_REVERSE_SCALE,
  PROP_WALK_ARM,
  PROP_WALK_SPEED_FALLOFF,
  PROP_WALK_HAND,
  THRUSTER_HEAT_RATE,
  THRUSTER_COOL_RATE,
  THRUSTER_HEAT_RESET,
  THRUSTER_TRIP_BASE,
  THRUSTER_TRIP_MIN,
  THRUSTER_FATIGUE_STEP,
  THRUSTER_TRIP_RECOVER,
} from './constants.js';

export function createBoat(x = 0, y = 0, heading = 0) {
  return {
    x, y, heading,
    vx: 0, vy: 0,
    omega: 0,
    // Engine throttle: target is "sticky", actual smooths toward it (engine response).
    throttleTarget: 0,
    throttle: 0,
    // Each direction key gets ONE allowed zone-crossing per press. When the
    // lever catches at neutral while the key is still held, the key is
    // "consumed" and further holding cannot move past the detent — the user
    // must release the key and press it again. Cleared on key release.
    throttleUpConsumed: false,
    throttleDownConsumed: false,
    // Visual feedback: short-lived bloom on the neutral band after a catch.
    catchPulse: 0,
    // Rudder helm: target is auto-return (set by key state), actual smooths toward it.
    rudderTarget: 0,
    rudder: 0,
    // Tunnel thrusters: MOMENTARY (-1 = full port, +1 = full starboard).
    // Actual value spools quickly toward whatever is held right now.
    bowThruster: 0,
    sternThruster: 0,
    // Per-unit overheat gauges (0..1), lockout flags, and (fatigue) trip
    // thresholds. The trip threshold drops with each overheat and recovers
    // while rested.
    bowHeat: 0,
    sternHeat: 0,
    bowLocked: false,
    sternLocked: false,
    bowTrip: THRUSTER_TRIP_BASE,
    sternTrip: THRUSTER_TRIP_BASE,
  };
}

// Advance one thruster's heat model and return the effective command after
// the overheat lockout. While locked the command is forced to 0 (motor cut
// out) and the gauge keeps cooling until it drops below the reset threshold.
// Each overheat applies thermal fatigue, lowering this unit's trip point so
// the next overheat arrives sooner; the trip point recovers while rested.
function stepThrusterHeat(boat, rawCmd, dt, heatKey, lockKey, tripKey) {
  let cmd = clamp(rawCmd, -1, 1);
  if (boat[lockKey]) cmd = 0;
  const load = Math.abs(cmd);
  if (load > 0.01) {
    boat[heatKey] = Math.min(1, boat[heatKey] + THRUSTER_HEAT_RATE * load * dt);
  } else {
    boat[heatKey] = Math.max(0, boat[heatKey] - THRUSTER_COOL_RATE * dt);
    // Recover trip capacity only while genuinely rested (cool).
    if (boat[heatKey] < THRUSTER_HEAT_RESET) {
      boat[tripKey] = Math.min(THRUSTER_TRIP_BASE, boat[tripKey] + THRUSTER_TRIP_RECOVER * dt);
    }
  }
  if (!boat[lockKey] && boat[heatKey] >= boat[tripKey]) {
    boat[lockKey] = true;
    // Fatigue: bring the next trip point earlier.
    boat[tripKey] = Math.max(THRUSTER_TRIP_MIN, boat[tripKey] - THRUSTER_FATIGUE_STEP);
  } else if (boat[lockKey] && boat[heatKey] <= THRUSTER_HEAT_RESET) {
    boat[lockKey] = false;
  }
  return cmd;
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
  // Reset the "consumed" flags whenever the key is not held — that's the
  // edge that lets the next press cross a zone again.
  if (!keys.throttleUp) boat.throttleUpConsumed = false;
  if (!keys.throttleDown) boat.throttleDownConsumed = false;

  // Throttle — STICKY with NEUTRAL DETENT CATCH:
  //   * Hold W/S → throttleTarget ramps. When the target crosses into the
  //     ±NEUTRAL_BAND zone from outside, it snaps to 0 and the key is
  //     "consumed" — further holding the same key cannot move past until it
  //     is released and pressed again. One zone transition per key press.
  //   * Space → snap to 0 AND consume any held throttle key, so the boat
  //     doesn't immediately ramp away from neutral.
  //   * Mouse drag on the handle → bypasses the catch (direct manipulation).
  if (keys.neutral) {
    if (boat.throttleTarget !== 0) boat.catchPulse = THROTTLE_CATCH_PULSE_TIME;
    boat.throttleTarget = 0;
    if (keys.throttleUp) boat.throttleUpConsumed = true;
    if (keys.throttleDown) boat.throttleDownConsumed = true;
  } else if (!keys.mouseDraggingThrottle) {
    let rate = 0;
    if (keys.throttleUp) rate += THROTTLE_RAMP_RATE;
    if (keys.throttleDown) rate -= THROTTLE_RAMP_RATE;

    if (rate !== 0) {
      let newTarget = clamp(boat.throttleTarget + rate * dt, -1, 1);

      // Catch when entering the neutral band from outside.
      const enteringFromBelow =
        rate > 0 &&
        boat.throttleTarget < -THROTTLE_NEUTRAL_BAND &&
        newTarget >= -THROTTLE_NEUTRAL_BAND;
      const enteringFromAbove =
        rate < 0 &&
        boat.throttleTarget > THROTTLE_NEUTRAL_BAND &&
        newTarget <= THROTTLE_NEUTRAL_BAND;

      if (enteringFromBelow) {
        newTarget = 0;
        boat.throttleUpConsumed = true;
        boat.catchPulse = THROTTLE_CATCH_PULSE_TIME;
      } else if (enteringFromAbove) {
        newTarget = 0;
        boat.throttleDownConsumed = true;
        boat.catchPulse = THROTTLE_CATCH_PULSE_TIME;
      } else if (boat.throttleTarget === 0) {
        // Sitting at the catch — a held key whose press already crossed
        // cannot move the lever out of neutral until it is re-pressed.
        if (rate > 0 && boat.throttleUpConsumed) newTarget = 0;
        if (rate < 0 && boat.throttleDownConsumed) newTarget = 0;
      }

      boat.throttleTarget = newTarget;
    }
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

// Advance the boat one fixed step. `wind` (optional) is the world environment
// wind state: { speed, fromBearing }. Pass null/undefined for calm air.
export function stepBoat(boat, keys, wind, dt) {
  updateTargetsFromKeys(boat, keys, dt);

  // Engine response & helm response (smooth toward targets).
  boat.throttle = lerpTowards(boat.throttle, boat.throttleTarget, THROTTLE_RATE, dt);
  boat.rudder = lerpTowards(boat.rudder, boat.rudderTarget, RUDDER_RATE, dt);

  // Thrusters are momentary: target IS the current key/button state, and
  // the unit spools toward it quickly (release → snaps back to neutral).
  // Heat model gates the command — an overheated unit is locked out.
  const bowTarget = stepThrusterHeat(boat, keys.bowThruster || 0, dt, 'bowHeat', 'bowLocked', 'bowTrip');
  const sternTarget = stepThrusterHeat(boat, keys.sternThruster || 0, dt, 'sternHeat', 'sternLocked', 'sternTrip');
  boat.bowThruster = lerpTowards(boat.bowThruster, bowTarget, THRUSTER_RATE, dt);
  boat.sternThruster = lerpTowards(boat.sternThruster, sternTarget, THRUSTER_RATE, dt);

  // Decay the visual catch pulse.
  if (boat.catchPulse > 0) {
    boat.catchPulse = Math.max(0, boat.catchPulse - dt);
  }

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

  // Engine thrust along forward axis. Inside the neutral band the gearbox
  // is in NEUTRAL (clutch disengaged) — engine RPM may still be up but the
  // prop produces no thrust. Beyond the band the value is rescaled so that
  // |throttle|=1 still gives full thrust. Reverse is weaker than forward.
  const tMag = Math.abs(boat.throttle);
  let engaged = 0;
  if (tMag > THROTTLE_NEUTRAL_BAND) {
    const sign = boat.throttle >= 0 ? 1 : -1;
    engaged = (sign * (tMag - THROTTLE_NEUTRAL_BAND)) / (1 - THROTTLE_NEUTRAL_BAND);
  }
  const thrustScale = engaged >= 0 ? 1 : THRUST_REVERSE_SCALE;
  const F_thrust = engaged * THRUST_MAX * thrustScale;

  // Forward drag at CG.
  const F_drag_fwd =
    -DRAG_FWD_LIN * vFwd - DRAG_FWD_QUAD * vFwd * Math.abs(vFwd);

  // Rudder lift force, applied at the stern (x = -RUDDER_ARM), perpendicular
  // to the hull. Magnitude ∝ vFwd² with sign from vFwd·|vFwd| so reversing
  // flips the side the stern is kicked toward — exactly like a real boat.
  const F_rudder = -RUDDER_LIFT * boat.rudder * vFwd * Math.abs(vFwd);

  // Prop walk — lateral kick at the stern from the turning prop. Scales with
  // `engaged` (zero in the neutral band → no prop walk at neutral), far
  // stronger astern, present at zero speed, fading as the boat gathers way.
  const propWalkScale = engaged >= 0 ? 1 : PROP_WALK_REVERSE_SCALE;
  const propWalkFalloff = 1 / (1 + PROP_WALK_SPEED_FALLOFF * vFwd * vFwd);
  const F_propwalk = PROP_WALK_HAND * PROP_WALK_FORCE * engaged * propWalkScale * propWalkFalloff;

  // Tunnel thrusters: pure lateral jets at the bow / stern. Authority
  // washes out quadratically with forward speed — past a few knots the
  // tunnel flow collapses and they do next to nothing (docking aids only).
  const thrusterEff = 1 / (1 + THRUSTER_SPEED_FALLOFF * vFwd * vFwd);
  const F_bowT = boat.bowThruster * BOW_THRUSTER_FORCE * thrusterEff;
  const F_sternT = boat.sternThruster * STERN_THRUSTER_FORCE * thrusterEff;

  // Wind force at the windage point (body x = +WIND_ARM, slightly forward of
  // CG). World wind velocity (fromBearing is meteorological — direction the
  // wind COMES FROM, so we negate to get the velocity vector). Canvas axes:
  // +x = east, +y = south, so bearing α (0=N) → unit direction (sin α, -cos α).
  let F_wind_body_x = 0;
  let F_wind_body_y = 0;
  if (wind && wind.speed > 0.01) {
    // Wind velocity in world frame (blowing TO bearing + π = away from origin).
    const windVx = -Math.sin(wind.fromBearing) * wind.speed;
    const windVy =  Math.cos(wind.fromBearing) * wind.speed;
    // World velocity of the windage point (CG velocity + rotational lever).
    const windagePtVx = boat.vx - boat.omega * WIND_ARM * sinH;
    const windagePtVy = boat.vy + boat.omega * WIND_ARM * cosH;
    // Apparent wind = what the boat actually feels at that point.
    const appWx = windVx - windagePtVx;
    const appWy = windVy - windagePtVy;
    const appW = Math.hypot(appWx, appWy);
    // Quadratic drag in apparent-wind direction.
    const F_wind_world_x = WIND_COEF * appW * appWx;
    const F_wind_world_y = WIND_COEF * appW * appWy;
    // World → body so we can sum with the hull forces and torque correctly.
    F_wind_body_x =  F_wind_world_x * cosH + F_wind_world_y * sinH;
    F_wind_body_y = -F_wind_world_x * sinH + F_wind_world_y * cosH;
  }

  // Sum of body-frame forces.
  const F_body_x = F_thrust + F_drag_fwd + F_wind_body_x;
  const F_body_y =
    F_lat_bow + F_lat_stern + F_rudder + F_wind_body_y + F_bowT + F_sternT + F_propwalk;

  // Torque about CG: τ = Σ x_b · F_y for each lateral force at (x_b, 0).
  const tau =
    HULL_DRAG_ARM * F_lat_bow +
    -HULL_DRAG_ARM * F_lat_stern +
    -RUDDER_ARM * F_rudder +
    WIND_ARM * F_wind_body_y +
    THRUSTER_BOW_ARM * F_bowT +
    -THRUSTER_STERN_ARM * F_sternT +
    -PROP_WALK_ARM * F_propwalk;

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

// Diagnostic helper used by the renderer (HUD speed readout).
export function boatSpeed(boat) {
  return Math.hypot(boat.vx, boat.vy);
}
