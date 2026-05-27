// All tunable values for the boat simulation live here.
// Units are "feel units" rather than strict SI — ratios matter more than
// absolute values. Tweak these to dial in the handling.
//
// Three groups dominate the handling feel:
//   - DRAG_LAT_*   → how much the hull slides sideways (drift amount)
//   - RUDDER_GAIN  → how responsive the boat is to the helm at speed
//   - YAW_DAMP_*   → how long the boat keeps rotating after centering the helm

export const PX_PER_M = 20;
export const M_TO_KN = 1.94384;

export const FIXED_DT = 1 / 120;
export const MAX_STEPS_PER_FRAME = 6;

// Boat physical params
export const MASS = 1500;
export const I_Z = 2200;

// Engine
export const THRUST_MAX = 9000;
export const THRUST_REVERSE_SCALE = 0.4;

// Hydrodynamic drag (forward axis: lower; lateral axis: much higher)
export const DRAG_FWD_LIN = 50;
export const DRAG_FWD_QUAD = 25;
export const DRAG_LAT_LIN = 600;
export const DRAG_LAT_QUAD = 400;

// Rudder torque scales with forward speed (water flow over the rudder).
export const RUDDER_GAIN = 900;

// Yaw resistance (water resists rotation; quadratic term bites at high omega)
export const YAW_DAMP_LIN = 800;
export const YAW_DAMP_QUAD = 300;

// How fast input targets are tracked by the actual throttle/rudder.
// Lower = more deliberate/sluggish controls (more boat-like).
export const THROTTLE_RATE = 1.2;
export const RUDDER_RATE = 3.0;

// Boat hull dimensions (meters)
export const BOAT_LENGTH = 6;
export const BOAT_WIDTH = 2.2;

// Wake trail
export const WAKE_EMIT_INTERVAL = 0.04;  // seconds between wake points
export const WAKE_LIFETIME = 3.0;        // seconds before a wake point fades out
export const WAKE_MAX_POINTS = 200;
