import {
  PX_PER_M,
  M_TO_KN,
  BOAT_LENGTH,
  BOAT_WIDTH,
  WAKE_LIFETIME,
} from './constants.js';

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
    drawHud(ctx, w, h, world.boat);
  }

  return { draw };
}

// ---------- Sea ----------

function drawSea(ctx, w, h, world) {
  const t = world.time;
  const b = world.boat;

  // Base gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a3a55');
  grad.addColorStop(1, '#0e6b8e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle moving wave bands. We project the camera offset so the bands
  // appear to scroll with the boat — sells the sense of motion.
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

  // Glints — a few scattered short strokes.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#cbeaf6';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 32; i++) {
    const seed = i * 73.13;
    const px = (((seed + t * 14) % (w + 80)) - 40);
    const py = (((seed * 1.7 + t * 9) % (h + 80)) - 40);
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
  // For each entity, translate world → screen and draw. Empty for now.
  // Example shape for later:
  //   for (const e of world.entities) { ... }
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
  ctx.moveTo(half, 0);                     // bow tip
  ctx.lineTo(half * 0.4, halfW);           // bow shoulder (starboard)
  ctx.lineTo(-half, halfW * 0.85);         // stern starboard
  ctx.lineTo(-half, -halfW * 0.85);        // stern port
  ctx.lineTo(half * 0.4, -halfW);          // bow shoulder (port)
  ctx.closePath();
  ctx.fillStyle = '#f5e8c8';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#5a4423';
  ctx.stroke();

  // Cockpit/cabin
  ctx.beginPath();
  ctx.rect(-half * 0.2, -halfW * 0.55, half * 0.6, halfW * 1.1);
  ctx.fillStyle = '#3a6b87';
  ctx.fill();
  ctx.strokeStyle = '#1c3b4d';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Rudder indicator (drawn at the stern, angled by current rudder value).
  ctx.save();
  ctx.translate(-half, 0);
  ctx.rotate(boat.rudder * 0.6);  // visual: up to ~35° deflection
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-12, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// ---------- HUD ----------

function drawHud(ctx, w, h, boat) {
  ctx.save();
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const speedKn = Math.hypot(boat.vx, boat.vy) * M_TO_KN;
  // Heading in compass-ish degrees (0..360). 0 = +x (east). Good enough as a number.
  let headingDeg = (boat.heading * 180) / Math.PI;
  headingDeg = ((headingDeg % 360) + 360) % 360;

  // Top-right panel
  const panelW = 220;
  const panelH = 130;
  const px = w - panelW - 16;
  const py = 16;
  roundedRect(ctx, px, py, panelW, panelH, 10);
  ctx.fillStyle = 'rgba(6, 26, 40, 0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.25)';
  ctx.stroke();

  ctx.fillStyle = '#e6f4fb';
  ctx.fillText(`Speed   ${speedKn.toFixed(1)} kn`, px + 14, py + 24);
  ctx.fillText(`Heading ${headingDeg.toFixed(0).padStart(3, ' ')}°`, px + 14, py + 44);

  // Throttle bar
  ctx.fillText('Throttle', px + 14, py + 70);
  drawBar(ctx, px + 80, py + 60, 120, 12, boat.throttle);

  // Rudder bar
  ctx.fillText('Rudder', px + 14, py + 100);
  drawBar(ctx, px + 80, py + 90, 120, 12, boat.rudder);

  // Bottom-left controls hint
  const hintLines = [
    'W / ↑   Throttle forward',
    'S / ↓   Reverse',
    'A / ←   Helm left',
    'D / →   Helm right',
    'Space   Center helm & cut throttle',
  ];
  ctx.fillStyle = 'rgba(230, 244, 251, 0.7)';
  hintLines.forEach((line, i) => {
    ctx.fillText(line, 16, h - 16 - (hintLines.length - 1 - i) * 18);
  });

  ctx.restore();
}

function drawBar(ctx, x, y, w, h, value) {
  // value: -1..1; centered bar.
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const fillW = (Math.max(-1, Math.min(1, value)) * w) / 2;
  ctx.fillStyle = value >= 0 ? '#7fd8b6' : '#e6a17f';
  if (fillW >= 0) ctx.fillRect(cx, y, fillW, h);
  else ctx.fillRect(cx + fillW, y, -fillW, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, y + h);
  ctx.stroke();
  ctx.restore();
}

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
