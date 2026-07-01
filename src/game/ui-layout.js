// Layout and hit-testing for on-screen UI controls. Shared between the
// renderer (to draw the controls) and the input layer (to handle mouse /
// touch interactions) so both stay in sync.
//
// The layout is responsive: on a phone-sized (narrow / short) viewport the
// controls shrink and spread along the bottom edge — helm bottom-LEFT,
// thrusters bottom-CENTRE, throttle bottom-RIGHT — instead of the desktop
// arrangement (helm centred, thrusters + throttle clustered bottom-right).

const PANEL_W = 130;
const PANEL_H = 360;
const PANEL_MARGIN = 16;

const TRACK_TOP_INSET = 32;
const TRACK_BOTTOM_INSET = 46;
const TRACK_W = 14;
const KNOB_W = 46;
const KNOB_H = 20;

// A viewport counts as "compact" (phone-like) when it is narrow OR short. The
// thresholds match the CSS media query in globals.css so the HTML overlays and
// the canvas-drawn controls switch to the mobile layout together.
const COMPACT_MAX_W = 680;
const COMPACT_MAX_H = 540;
export function isCompactUI(w, h) {
  return w < COMPACT_MAX_W || h < COMPACT_MAX_H;
}

// Tall-enough narrow screens (a phone held in portrait) use the "console
// stack" arrangement: a larger helm centred at the bottom, with the thrusters
// sitting directly ABOVE the throttle on the right (both worked by the right
// thumb). The 720px height floor guarantees that column clears the top-right
// button stack; shorter narrow screens fall back to the spread layout so
// nothing collides.
function usePortraitStack(w, h) {
  return w < COMPACT_MAX_W && h >= 720;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Geometry for the throttle handle. Anchored to the BOTTOM-RIGHT of the canvas
// in both layouts; compact just makes it narrower / shorter and lifts it clear
// of the phone's home-indicator area.
export function throttleLayout(canvasCssW, canvasCssH) {
  const compact = isCompactUI(canvasCssW, canvasCssH);
  const margin = compact ? 12 : PANEL_MARGIN;
  const bottomMargin = compact ? 28 : PANEL_MARGIN;
  const panelW = compact ? 84 : PANEL_W;
  const panelH = compact ? clamp(canvasCssH * 0.44, 196, 300) : PANEL_H;
  const topInset = compact ? 24 : TRACK_TOP_INSET;
  const bottomInset = compact ? 38 : TRACK_BOTTOM_INSET;
  const trackW = compact ? 12 : TRACK_W;
  const knobW = compact ? 40 : KNOB_W;
  const knobH = compact ? 18 : KNOB_H;

  const px = canvasCssW - panelW - margin;
  const py = canvasCssH - panelH - bottomMargin;
  const trackTop = py + topInset;
  const trackBottom = py + panelH - bottomInset;
  const trackH = trackBottom - trackTop;
  const trackCx = px + panelW / 2;
  return {
    panelW,
    panelH,
    px,
    py,
    trackTop,
    trackBottom,
    trackH,
    trackCx,
    trackW,
    knobW,
    knobH,
  };
}

// Hit area is generous — the full width of the knob/zone wash, plus a small
// margin above/below the track ends so the user can grab the FULL/FULL ends.
export function hitTestThrottle(x, y, layout) {
  const halfW = Math.max(layout.knobW, layout.trackW + 36) / 2 + 8;
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

// ---------- Thruster rockers (bow / stern) ----------

const THRUSTER_PANEL_W = 104;
const THRUSTER_PANEL_H = 158;
const THRUSTER_GAP = 12; // gap between thruster panel and throttle panel

// Two horizontal momentary rockers stacked vertically. Desktop: just to the
// LEFT of the throttle handle. Compact: centred along the bottom edge, in the
// gap between the bottom-left helm and the bottom-right throttle.
export function thrusterLayout(canvasCssW, canvasCssH) {
  // Portrait phones: thrusters stacked directly ABOVE the throttle, sharing
  // its width and left edge so the two form one right-hand console.
  if (usePortraitStack(canvasCssW, canvasCssH)) {
    const t = throttleLayout(canvasCssW, canvasCssH);
    const panelW = t.panelW;
    const panelH = 128;
    const gap = 10;
    const px = t.px;
    const py = t.py - panelH - gap;
    const rockerW = panelW - 16;
    const rockerH = 32;
    return {
      px,
      py,
      panelW,
      panelH,
      bow: { x: px + 8, y: py + 30, w: rockerW, h: rockerH },
      stern: { x: px + 8, y: py + 84, w: rockerW, h: rockerH },
    };
  }

  // Shorter / mid-height compact screens: thrusters centred along the bottom,
  // between the bottom-left helm and the bottom-right throttle.
  if (isCompactUI(canvasCssW, canvasCssH)) {
    const panelW = 92;
    const panelH = 138;
    const bottomMargin = 28;
    // Nudge slightly right of dead-centre so it sits in the open gap toward
    // the throttle rather than crowding the helm on the left.
    const px = Math.round((canvasCssW - panelW) / 2 + 14);
    const py = canvasCssH - panelH - bottomMargin;
    const rockerW = panelW - 16;
    const rockerH = 34;
    return {
      px,
      py,
      panelW,
      panelH,
      bow: { x: px + 8, y: py + 34, w: rockerW, h: rockerH },
      stern: { x: px + 8, y: py + 92, w: rockerW, h: rockerH },
    };
  }

  const t = throttleLayout(canvasCssW, canvasCssH);
  const px = t.px - THRUSTER_PANEL_W - THRUSTER_GAP;
  const py = t.py + t.panelH - THRUSTER_PANEL_H; // bottom-aligned with throttle
  const rockerW = THRUSTER_PANEL_W - 16;
  const rockerH = 38;
  return {
    px,
    py,
    panelW: THRUSTER_PANEL_W,
    panelH: THRUSTER_PANEL_H,
    bow: { x: px + 8, y: py + 38, w: rockerW, h: rockerH },
    stern: { x: px + 8, y: py + 104, w: rockerW, h: rockerH },
  };
}

// Which rocker half (if any) is under the point? Returns
// { unit: 'bow'|'stern', dir: -1 (port) | +1 (starboard) } or null.
export function hitTestThruster(x, y, layout) {
  for (const unit of ['bow', 'stern']) {
    const r = layout[unit];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      return { unit, dir: x < r.x + r.w / 2 ? -1 : 1 };
    }
  }
  return null;
}

// ---------- Helm (steering wheel) ----------

const HELM_RADIUS = 78;
const HELM_BOTTOM_MARGIN = 28;
const HELM_HIT_PAD = 16;

// Desktop: helm anchored BOTTOM-CENTRE. Compact: BOTTOM-LEFT and smaller, so
// the centre + right stay free for the thrusters and throttle.
export function helmLayout(canvasCssW, canvasCssH) {
  // Portrait phones: a larger helm, centred in the space LEFT of the right-hand
  // throttle/thruster console (i.e. excluding the console's width) rather than
  // dead-centre of the screen.
  if (usePortraitStack(canvasCssW, canvasCssH)) {
    const radius = 62;
    const t = throttleLayout(canvasCssW, canvasCssH);
    return {
      cx: t.px / 2, // centre of the free area to the left of the console
      cy: canvasCssH - radius - 62, // room for the HELM label + home indicator
      radius,
    };
  }
  // Shorter / mid-height compact screens: smaller helm tucked bottom-left so
  // the centre + right stay clear for the thrusters and throttle.
  if (isCompactUI(canvasCssW, canvasCssH)) {
    const radius = 50;
    return {
      cx: 14 + radius + 12,
      cy: canvasCssH - radius - 62,
      radius,
    };
  }
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
