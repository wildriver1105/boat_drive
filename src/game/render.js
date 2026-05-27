import {
  PX_PER_M,
  M_TO_KN,
  BOAT_LENGTH,
  BOAT_WIDTH,
  WAKE_LIFETIME,
  RUDDER_ARM,
} from './constants.js';
import { lateralPivotBodyX } from './physics.js';
import { throttleLayout } from './ui-layout.js';

// Build a renderer bound to a specific canvas. Returns a draw(world) function.
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function draw(world) {
    const dpr = canvas._dpr || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawSea(ctx, w, h, world);
    drawWake(ctx, w, h, world);
    drawEntities(ctx, w, h, world);
    drawBoat(ctx, w, h, world.boat);
    drawThrottleHandle(ctx, w, h, world.boat);
    drawInfoPanel(ctx, w, h, world.boat);
    drawHints(ctx, w, h);
  }

  return { draw };
}

// ---------- Sea ----------

function drawSea(ctx, w, h, world) {
  const t = world.time;
  const b = world.boat;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a3a55');
  grad.addColorStop(1, '#0e6b8e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle moving wave bands that scroll with the boat.
  const camOffX = (b.x * PX_PER_M) % 80;
  const camOffY = (b.y * PX_PER_M) % 80;
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#bfe7f5';
  for (let i = -2; i < Math.ceil(h / 80) + 2; i++) {
    const y = i * 80 - camOffY + Math.sin(t * 0.6 + i * 0.7) * 6;
    ctx.fillRect(-camOffX - 40, y, w + 120, 2);
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#cbeaf6';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 32; i++) {
    const seed = i * 73.13;
    const px = ((seed + t * 14) % (w + 80)) - 40;
    const py = ((seed * 1.7 + t * 9) % (h + 80)) - 40;
    const len = 6 + (i % 3) * 3;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + len, py);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Wake ----------

function drawWake(ctx, w, h, world) {
  const cx = w / 2;
  const cy = h / 2;
  const bx = world.boat.x;
  const by = world.boat.y;

  ctx.save();
  for (const p of world.wake) {
    const age = world.time - p.born;
    const a = 1 - age / WAKE_LIFETIME;
    if (a <= 0) continue;
    const screenX = cx + (p.x - bx) * PX_PER_M;
    const screenY = cy + (p.y - by) * PX_PER_M;
    const r = 2 + age * 6;
    ctx.globalAlpha = 0.35 * a;
    ctx.fillStyle = '#eaf6fb';
    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- Entities (reserved for future map editor) ----------

function drawEntities(ctx, w, h, world) {
  void ctx; void w; void h; void world;
}

// ---------- Boat ----------

function drawBoat(ctx, w, h, boat) {
  const cx = w / 2;
  const cy = h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(boat.heading);

  const L = BOAT_LENGTH * PX_PER_M;
  const W = BOAT_WIDTH * PX_PER_M;
  const half = L / 2;
  const halfW = W / 2;

  // Hull — pointed bow.
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(half * 0.4, halfW);
  ctx.lineTo(-half, halfW * 0.85);
  ctx.lineTo(-half, -halfW * 0.85);
  ctx.lineTo(half * 0.4, -halfW);
  ctx.closePath();
  ctx.fillStyle = '#f5e8c8';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#5a4423';
  ctx.stroke();

  // Cabin
  ctx.beginPath();
  ctx.rect(-half * 0.2, -halfW * 0.55, half * 0.6, halfW * 1.1);
  ctx.fillStyle = '#3a6b87';
  ctx.fill();
  ctx.strokeStyle = '#1c3b4d';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pivot-point marker — the instantaneous lateral center of rotation.
  // Drawn in body frame so it sits naturally where the hull is rotating about.
  // Forward of CG during a typical forward turn (≈ 1/3 from bow); aft of CG
  // during a sternboard turn. Clamped to the visible hull length.
  const pivotX = lateralPivotBodyX(boat);
  if (pivotX != null) {
    const clamped = Math.max(-half, Math.min(half, pivotX * PX_PER_M));
    ctx.save();
    ctx.fillStyle = 'rgba(255, 215, 90, 0.95)';
    ctx.strokeStyle = 'rgba(120, 70, 20, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(clamped, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Rudder indicator at the stern (visual deflection up to ~35°).
  ctx.save();
  ctx.translate(-RUDDER_ARM * PX_PER_M, 0);
  ctx.rotate(boat.rudder * 0.6);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-14, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// ---------- Throttle handle (marine telegraph style) ----------

function drawThrottleHandle(ctx, w, h, boat) {
  const layout = throttleLayout(w, h);
  const { panelW, panelH, px, py, trackTop, trackBottom, trackH, trackCx, trackW, knobW, knobH } = layout;
  const trackLeft = trackCx - trackW / 2;
  const valueToY = (v) => trackTop + (1 - (v + 1) / 2) * trackH;

  ctx.save();

  // Housing
  roundedRect(ctx, px, py, panelW, panelH, 12);
  const housingGrad = ctx.createLinearGradient(px, py, px, py + panelH);
  housingGrad.addColorStop(0, 'rgba(20, 40, 56, 0.78)');
  housingGrad.addColorStop(1, 'rgba(6, 18, 28, 0.78)');
  ctx.fillStyle = housingGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Title
  ctx.fillStyle = 'rgba(220, 240, 250, 0.75)';
  ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THROTTLE', px + panelW / 2, py + 18);

  // AHEAD / ASTERN zone wash behind the track.
  ctx.fillStyle = 'rgba(72, 168, 110, 0.18)';
  ctx.fillRect(trackLeft - 22, trackTop, trackW + 44, trackH / 2);
  ctx.fillStyle = 'rgba(196, 96, 76, 0.20)';
  ctx.fillRect(trackLeft - 22, trackTop + trackH / 2, trackW + 44, trackH / 2);

  // Neutral detent band
  const neutralBandH = 12;
  ctx.fillStyle = 'rgba(170, 180, 195, 0.32)';
  ctx.fillRect(
    trackLeft - 26,
    trackTop + trackH / 2 - neutralBandH / 2,
    trackW + 52,
    neutralBandH
  );

  // Track itself
  ctx.fillStyle = 'rgba(8, 18, 26, 0.95)';
  ctx.fillRect(trackLeft, trackTop, trackW, trackH);
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(trackLeft, trackTop, trackW, trackH);

  // Notch lines + labels
  const notches = [
    { v: 1,    label: 'FULL', major: true },
    { v: 2/3,  label: '2/3',  major: false },
    { v: 1/3,  label: '1/3',  major: false },
    { v: 0,    label: 'N',    major: true, neutral: true },
    { v: -1/3, label: '1/3',  major: false },
    { v: -2/3, label: '2/3',  major: false },
    { v: -1,   label: 'FULL', major: true },
  ];
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  for (const n of notches) {
    const y = valueToY(n.v);
    const halfLen = n.major ? 13 : 8;
    ctx.strokeStyle = n.major
      ? 'rgba(225, 240, 250, 0.85)'
      : 'rgba(180, 200, 215, 0.45)';
    ctx.lineWidth = n.major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(trackLeft - halfLen, y);
    ctx.lineTo(trackLeft + trackW + halfLen, y);
    ctx.stroke();

    if (n.neutral) {
      // Small detent triangles flanking the neutral mark
      ctx.fillStyle = 'rgba(225, 240, 250, 0.85)';
      ctx.beginPath();
      ctx.moveTo(trackLeft - halfLen - 6, y);
      ctx.lineTo(trackLeft - halfLen, y - 4);
      ctx.lineTo(trackLeft - halfLen, y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(trackLeft + trackW + halfLen + 6, y);
      ctx.lineTo(trackLeft + trackW + halfLen, y - 4);
      ctx.lineTo(trackLeft + trackW + halfLen, y + 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(210, 225, 240, 0.55)';
    ctx.fillText(n.label, trackLeft + trackW + halfLen + 8, y + 3);
  }

  // AHEAD / ASTERN zone labels (sideways down the left edge).
  ctx.save();
  ctx.fillStyle = 'rgba(140, 220, 170, 0.7)';
  ctx.font = 'bold 9px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.translate(trackLeft - 18, trackTop + trackH * 0.25);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('AHEAD', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = 'rgba(230, 150, 130, 0.7)';
  ctx.font = 'bold 9px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.translate(trackLeft - 18, trackTop + trackH * 0.75);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('ASTERN', 0, 0);
  ctx.restore();

  // Actual (smoothed) throttle — small dot, lags target while engine spools.
  {
    const y = valueToY(boat.throttle);
    ctx.fillStyle = 'rgba(255, 220, 110, 0.85)';
    ctx.beginPath();
    ctx.arc(trackCx, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Knob at target — the lever handle (sized from shared layout).
  {
    const y = valueToY(boat.throttleTarget);
    const kx = trackCx - knobW / 2;
    const ky = y - knobH / 2;
    roundedRect(ctx, kx, ky, knobW, knobH, 5);
    const knobGrad = ctx.createLinearGradient(0, ky, 0, ky + knobH);
    knobGrad.addColorStop(0, '#e5eaf0');
    knobGrad.addColorStop(0.5, '#a3aec0');
    knobGrad.addColorStop(1, '#525c70');
    ctx.fillStyle = knobGrad;
    ctx.fill();
    ctx.strokeStyle = '#1b2028';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Center grip line
    ctx.beginPath();
    ctx.moveTo(kx + 8, y);
    ctx.lineTo(kx + knobW - 8, y);
    ctx.strokeStyle = 'rgba(20, 25, 35, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Status text — the current engine order (kept short).
  const order = throttleOrder(boat.throttleTarget);
  ctx.fillStyle = '#e6f4fb';
  ctx.font = 'bold 12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(order, px + panelW / 2, py + panelH - 22);
  // Percentage subtitle
  ctx.fillStyle = 'rgba(200, 220, 235, 0.6)';
  ctx.font = '10px monospace';
  const pct = (boat.throttleTarget * 100).toFixed(0);
  ctx.fillText(`${pct >= 0 ? '+' : ''}${pct}%`, px + panelW / 2, py + panelH - 8);

  ctx.restore();
}

function throttleOrder(value) {
  const a = Math.abs(value);
  if (a < 0.04) return 'NEUTRAL';
  const dir = value > 0 ? 'AHEAD' : 'ASTERN';
  if (a > 0.94) return 'FULL ' + dir;
  if (a > 0.78) return dir + ' 3/4';
  if (a > 0.55) return dir + ' 2/3';
  if (a > 0.42) return dir + ' 1/2';
  if (a > 0.22) return dir + ' 1/3';
  return dir + ' SLOW';
}

// ---------- Info panel (speed, heading, rudder) ----------

function drawInfoPanel(ctx, w, h, boat) {
  ctx.save();
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const speedKn = Math.hypot(boat.vx, boat.vy) * M_TO_KN;
  let headingDeg = (boat.heading * 180) / Math.PI;
  headingDeg = ((headingDeg % 360) + 360) % 360;

  const panelW = 220;
  const panelH = 100;
  const px = w - panelW - 16;
  const py = 16;
  roundedRect(ctx, px, py, panelW, panelH, 10);
  ctx.fillStyle = 'rgba(6, 26, 40, 0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.25)';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#e6f4fb';
  ctx.fillText(`Speed   ${speedKn.toFixed(1)} kn`, px + 14, py + 24);
  ctx.fillText(`Heading ${headingDeg.toFixed(0).padStart(3, ' ')}°`, px + 14, py + 44);

  ctx.fillText('Rudder', px + 14, py + 76);
  drawCenteredBar(ctx, px + 80, py + 66, 120, 12, boat.rudder);

  ctx.restore();
}

function drawCenteredBar(ctx, x, y, w, h, value) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const v = Math.max(-1, Math.min(1, value));
  const fillW = (v * w) / 2;
  ctx.fillStyle = v >= 0 ? '#7fd8b6' : '#e6a17f';
  if (fillW >= 0) ctx.fillRect(cx, y, fillW, h);
  else ctx.fillRect(cx + fillW, y, -fillW, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, y + h);
  ctx.stroke();
  ctx.restore();
}

// ---------- Hints ----------

function drawHints(ctx, w, h) {
  ctx.save();
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(230, 244, 251, 0.65)';
  ctx.textAlign = 'left';
  const lines = [
    'W / ↑    Throttle up (sticky)',
    'S / ↓    Throttle down (sticky)',
    'A / ←    Helm left',
    'D / →    Helm right',
    'Space    Snap throttle to neutral',
    'Mouse    Drag the throttle lever',
  ];
  const x = 16;
  const yTop = 24;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, yTop + i * 18);
  });
  ctx.restore();
  void w; void h;
}

// ---------- Geometry helpers ----------

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
