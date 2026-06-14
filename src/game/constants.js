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

// Marine throttles have a sizeable NEUTRAL ZONE in the middle of the lever
// travel — a wide click-region where the gearbox is in neutral and the
// propeller produces no thrust regardless of engine RPM. Within
// ±THROTTLE_NEUTRAL_BAND of zero the boat is in neutral (engine idling,
// clutch disengaged). The keyboard ramp "catches" when entering this band
// so the lever cannot be pushed straight through F↔N↔R without a
// deliberate re-press of the key. Width is comparable to the green N arc
// on a real single-lever marine control.
export const THROTTLE_NEUTRAL_BAND = 0.12;
// How long the visual "catch" pulse lingers on the neutral band after a
// catch event — purely cosmetic, gives the user the "탁" feedback.
export const THROTTLE_CATCH_PULSE_TIME = 0.45;

// === Prop walk (transverse thrust of a single fixed propeller) ===
// A turning prop kicks the stern sideways. It exists ONLY while the gearbox
// is engaged (scales with `engaged`, so it is zero in the neutral band — a
// real boat has no prop walk at neutral), is MUCH stronger astern than
// ahead, works even at zero boat speed (docking aid), and fades with forward
// speed. Applied as a lateral force at the stern so it both walks the stern
// and yaws the hull. PROP_WALK_HAND = +1 models a right-hand prop: stern to
// STARBOARD ahead, to PORT astern. Flip to -1 for a left-hand prop.
export const PROP_WALK_FORCE = 130;          // N lateral at full ahead throttle
export const PROP_WALK_REVERSE_SCALE = 3.0;  // astern prop walk is far stronger
export const PROP_WALK_ARM = 2.6;            // applied near the stern / prop
export const PROP_WALK_SPEED_FALLOFF = 0.1;  // authority ∝ 1/(1 + k·vFwd²)
export const PROP_WALK_HAND = 1;             // +1 right-hand prop, -1 left-hand

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

// === Thrusters ===
// Tunnel thrusters at the bow and stern: lateral jets used for docking.
// MOMENTARY controls — they thrust only while held and snap back to
// neutral on release, like the spring-return rocker on a real panel.
// Force applied at (±THRUSTER_*_ARM, 0) so each unit both translates the
// hull and yaws it about the CG. Authority falls off quickly with forward
// speed (tunnel flow washes out) — they're docking tools, not steering.
export const BOW_THRUSTER_FORCE = 900;    // N
export const STERN_THRUSTER_FORCE = 900;  // N
export const THRUSTER_BOW_ARM = 2.4;      // m forward of CG
export const THRUSTER_STERN_ARM = 2.4;    // m aft of CG
export const THRUSTER_RATE = 6;           // 1/s — spool up/down speed
export const THRUSTER_SPEED_FALLOFF = 0.12; // authority ∝ 1/(1 + k·vFwd²)

// Duty cycle: tunnel thrusters can't run continuously — the motor heats up.
// Each unit has its own 0..1 heat gauge that rises while thrusting and cools
// while idle. At 1.0 it OVERHEATS and locks out; it stays locked until the
// gauge cools back below THRUSTER_HEAT_RESET, forcing a real rest period.
export const THRUSTER_HEAT_RATE = 0.34;   // 1/s heating → ~3s of full use to trip
export const THRUSTER_COOL_RATE = 0.45;   // 1/s cooling while idle
export const THRUSTER_HEAT_RESET = 0.2;   // must cool to here before unlocking

// Thermal fatigue: every overheat lowers the trip point, so repeated abuse
// trips the motor progressively sooner. The trip threshold starts at the
// nominal TRIP_BASE (~2/3 of the gauge), drops by FATIGUE_STEP each overheat
// (floored at TRIP_MIN), and slowly recovers back toward TRIP_BASE while the
// unit is genuinely rested (cool).
export const THRUSTER_TRIP_BASE = 0.67;   // nominal trip point & recovery ceiling
export const THRUSTER_TRIP_MIN = 0.35;    // floor for the shrinking trip point
export const THRUSTER_FATIGUE_STEP = 0.08; // trip point drop per overheat
export const THRUSTER_TRIP_RECOVER = 0.05; // 1/s trip-point recovery while rested

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

// === Collisions ===
// Parked boats get mass from their footprint so bigger hulls are harder to
// shove. The player boat (MASS=1500 over 6×2.2 m) is ~115 kg/m² — use the
// same density so pushing feels consistent. Docks are immovable (infinite
// mass) — the solver gives them invMass = 0.
export const ENTITY_DENSITY = 115;          // kg per m² of footprint
export const COLLISION_RESTITUTION = 0.22;  // bounciness (boats are fendered, not billiard balls)
export const COLLISION_FRICTION = 0.35;     // tangential grip during contact
export const COLLISION_CORRECTION = 0.8;    // fraction of penetration removed per step
export const ENTITY_LIN_DAMP = 0.9;         // 1/s — pushed boats bleed speed into the water
export const ENTITY_ANG_DAMP = 1.5;         // 1/s — and stop spinning fairly quickly

// === Wake (particle system) ===
export const WAKE_EMIT_INTERVAL = 0.04;
export const WAKE_MAX_POINTS = 480;

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
