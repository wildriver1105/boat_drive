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
// BOTH throttle and rudder are "sticky": while the key is held the target
// ramps at the rate below, and on key release the target STAYS where it was.
// Only Space snaps both back to neutral. Mouse drag on the throttle handle
// or the helm wheel writes the target directly (and suppresses key ramping
// for whichever control is being dragged).
export const THROTTLE_RAMP_RATE = 0.6;
export const RUDDER_RAMP_RATE = 0.8;

// Engine RPM smoothing — actual throttle eases toward target (target sets
// the order, engine spools up to that order with this rate).
export const THROTTLE_RATE = 1.5;
// Rudder hydraulic / cable transmission — actual rudder eases toward the
// helm setting at this rate. Small lag for organic feel.
export const RUDDER_RATE = 3.0;

// Helm geometry: how much the WHEEL rotates for the full ±100% rudder range.
// Kept below ±π so each rudder value has a unique visible wheel orientation
// (no ambiguity at the extremes).
export const HELM_MAX_ANGLE = Math.PI * 0.75; // ±135°

// === Wind (configured at runtime from the Settings modal) ===
// Aerodynamic drag style force from the air on the boat's freeboard /
// superstructure: |F_wind| = WIND_COEF × |v_apparent|², where v_apparent is
// the WIND velocity relative to the BOAT (i.e. v_wind − v_boat_at_windage).
// The force is applied at body-frame (WIND_ARM, 0) — a point forward of CG,
// because a small motor boat's freeboard / cabin / windshield is mostly
// forward. That offset produces a small weathervaning torque, so a beam
// wind tends to push the bow downwind (classic small-boat behavior).
export const WIND_COEF = 12;
export const WIND_ARM = 1.2;

// === Wake ===
export const WAKE_EMIT_INTERVAL = 0.04;
export const WAKE_LIFETIME = 3.0;
export const WAKE_MAX_POINTS = 200;

// === Wind streaks (America's Cup broadcast style) ===
// Sparse white world-space streaks that drift with the wind. Only render
// when the wind is strong enough to notice, and cap the count so they
// stay an ambient cue rather than visual clutter.
export const WIND_STREAK_MAX = 25;            // peak on-screen count at full wind
export const WIND_STREAK_LIFETIME = 2.6;       // seconds (mean; randomized ±20%)
export const WIND_STREAK_SPAWN_RADIUS_M = 32;  // spawn box half-side (world m around camera)
export const WIND_STREAK_THRESHOLD = 3;        // m/s; below this nothing spawns
export const WIND_STREAK_FULL_SPEED = 12;      // m/s; density reaches WIND_STREAK_MAX here
export const WIND_STREAK_LEN_M = 1.6;          // base length of each streak (±25%)
export const WIND_STREAK_ALPHA = 0.42;         // peak alpha at the middle of the envelope
