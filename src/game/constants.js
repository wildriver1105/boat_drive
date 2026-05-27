// All tunable values for the boat simulation live here.
// Units are "feel units" rather than strict SI — ratios matter more than
// absolute values.

export const PX_PER_M = 20;
export const M_TO_KN = 1.94384;

export const FIXED_DT = 1 / 120;
export const MAX_STEPS_PER_FRAME = 6;

// === Boat ===
export const MASS = 1500;
export const I_Z = 2200;
export const BOAT_LENGTH = 6;
export const BOAT_WIDTH = 2.2;

// === Engine ===
export const THRUST_MAX = 9000;
export const THRUST_REVERSE_SCALE = 0.4;  // reverse is weaker than forward

// === Hydrodynamic drag ===
// Forward drag at CG (hull sliding through water along its long axis).
export const DRAG_FWD_LIN = 50;
export const DRAG_FWD_QUAD = 25;

// Lateral drag is applied at TWO body-frame points along the centerline:
//   bow:   (+HULL_DRAG_ARM, 0)
//   stern: (-HULL_DRAG_ARM, 0)
// Because each point sees its own lateral velocity (which differs when the
// boat is yawing: vL_bow = vLat + ω·arm, vL_stern = vLat − ω·arm), this
// single mechanism produces:
//   • lateral skid resistance (translation)
//   • yaw damping              (rotation)
//   • bow/stern differential motion during turns (pivot-point behavior)
// No separate YAW_DAMP term is needed.
export const HULL_DRAG_ARM = 2.0;
export const DRAG_LAT_LIN_PER_POINT = 300;
export const DRAG_LAT_QUAD_PER_POINT = 200;

// === Rudder ===
// The rudder is a lifting surface AT THE STERN. The force it produces is
// perpendicular to the hull (lateral, in body frame) and is applied at
// body-frame position (-RUDDER_ARM, 0) — so it creates both lateral push
// AND a moment about the CG.
//
// Force magnitude is QUADRATIC in forward speed (real wing lift ∝ ½ρv²·A·Cl)
// using `vFwd·|vFwd|` to keep sign behavior:
//   • vFwd = 0  → rudder force = 0  (cannot rotate in place — realistic!)
//   • vFwd > 0  → flow over rudder pushes stern toward the opposite side
//   • vFwd < 0  → flow direction reversed → stern is pushed to the SAME side
//                as the rudder deflection (correct backing-down behavior)
export const RUDDER_ARM = 3.0;
export const RUDDER_LIFT = 75;

// === Input dynamics ===
// Throttle is "sticky": while W/S is held, throttleTarget ramps at this rate.
// On key release, the target STAYS where it was. Only Space snaps to 0.
export const THROTTLE_RAMP_RATE = 0.6;   // 1/s, full -1↔+1 sweep takes ~3.3s
export const THROTTLE_RATE = 1.5;        // engine RPM smoothing (target → actual)
// Rudder is auto-return: target tracks key state directly (no key = center).
export const RUDDER_RATE = 3.0;

// === Wake ===
export const WAKE_EMIT_INTERVAL = 0.04;
export const WAKE_LIFETIME = 3.0;
export const WAKE_MAX_POINTS = 200;
