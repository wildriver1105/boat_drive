// Layout and hit-testing for on-screen UI controls. Shared between the
// renderer (to draw the controls) and the input layer (to handle mouse /
// touch interactions) so both stay in sync.

const PANEL_W = 130;
const PANEL_H = 360;
const PANEL_MARGIN = 16;

const TRACK_TOP_INSET = 32;
const TRACK_BOTTOM_INSET = 46;
const TRACK_W = 14;
const KNOB_W = 46;
const KNOB_H = 20;

// Geometry for the throttle handle. Anchored to the BOTTOM-RIGHT of the canvas.
export function throttleLayout(canvasCssW, canvasCssH) {
  const px = canvasCssW - PANEL_W - PANEL_MARGIN;
  const py = canvasCssH - PANEL_H - PANEL_MARGIN;
  const trackTop = py + TRACK_TOP_INSET;
  const trackBottom = py + PANEL_H - TRACK_BOTTOM_INSET;
  const trackH = trackBottom - trackTop;
  const trackCx = px + PANEL_W / 2;
  return {
    panelW: PANEL_W,
    panelH: PANEL_H,
    px,
    py,
    trackTop,
    trackBottom,
    trackH,
    trackCx,
    trackW: TRACK_W,
    knobW: KNOB_W,
    knobH: KNOB_H,
  };
}

// Hit area is generous — the full width of the knob/zone wash, plus a small
// margin above/below the track ends so the user can grab the FULL/FULL ends.
export function hitTestThrottle(x, y, layout) {
  const halfW = Math.max(layout.knobW, layout.trackW + 36) / 2 + 6;
  if (x < layout.trackCx - halfW || x > layout.trackCx + halfW) return false;
  if (y < layout.trackTop - layout.knobH) return false;
  if (y > layout.trackBottom + layout.knobH) return false;
  return true;
}

// Map a mouse / touch y-coordinate to a throttle value in [-1, +1].
// Top of track = +1 (FULL AHEAD), bottom of track = -1 (FULL ASTERN).
export function yToThrottleValue(y, layout) {
  const t = (layout.trackBottom - y) / layout.trackH; // 0 at bottom, 1 at top
  const v = t * 2 - 1;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

// ---------- Helm (steering wheel) ----------

const HELM_RADIUS = 78;
const HELM_BOTTOM_MARGIN = 28;
const HELM_HIT_PAD = 16;

// Helm anchored to BOTTOM-CENTER. Center is the wheel center; `radius` is
// the rim radius (handles extend slightly past it).
export function helmLayout(canvasCssW, canvasCssH) {
  return {
    cx: canvasCssW / 2,
    cy: canvasCssH - HELM_RADIUS - HELM_BOTTOM_MARGIN,
    radius: HELM_RADIUS,
  };
}

export function hitTestHelm(x, y, layout) {
  const dx = x - layout.cx;
  const dy = y - layout.cy;
  const r = layout.radius + HELM_HIT_PAD;
  return dx * dx + dy * dy <= r * r;
}
