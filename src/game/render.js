import {
  PX_PER_M,
  M_TO_KN,
  BOAT_LENGTH,
  BOAT_WIDTH,
  WAKE_LIFETIME,
  RUDDER_ARM,
  HELM_MAX_ANGLE,
  WIND_STREAK_ALPHA,
  THROTTLE_NEUTRAL_BAND,
  THROTTLE_CATCH_PULSE_TIME,
} from './constants.js';
import { lateralPivotBodyX } from './physics.js';
import { throttleLayout, helmLayout } from './ui-layout.js';

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
    drawWindStreaks(ctx, w, h, world);
    drawWake(ctx, w, h, world);
    drawEntities(ctx, w, h, world);
    drawBoat(ctx, w, h, world);
    if (!world.edit.mode) {
      drawHelm(ctx, w, h, world.boat);
      drawThrottleHandle(ctx, w, h, world.boat);
      drawHints(ctx, w, h);
    } else {
      drawEditOverlay(ctx, w, h, world);
    }
    drawInfoPanel(ctx, w, h, world);
  }

  return { draw };
}

// ---------- Sea ----------

function drawSea(ctx, w, h, world) {
  const t = world.time;
  const cam = world.camera;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a3a55');
  grad.addColorStop(1, '#0e6b8e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle moving wave bands that scroll with the camera.
  const camOffX = (cam.x * PX_PER_M) % 80;
  const camOffY = (cam.y * PX_PER_M) % 80;
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

// ---------- Wind streaks (America's Cup broadcast style) ----------

function drawWindStreaks(ctx, w, h, world) {
  const streaks = world.windStreaks;
  if (!streaks || streaks.length === 0) return;

  const wind = world.wind;
  // Direction the wind is blowing TO. Streaks align with this vector.
  const dirX = wind ? -Math.sin(wind.fromBearing) : 0;
  const dirY = wind ?  Math.cos(wind.fromBearing) : 0;
  // If there's somehow no wind direction, bail.
  if (dirX === 0 && dirY === 0) return;

  const cx = w / 2;
  const cy = h / 2;
  const bx = world.camera.x;
  const by = world.camera.y;
  const t = world.time;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;

  for (let i = 0; i < streaks.length; i++) {
    const s = streaks[i];
    const age = t - s.born;
    if (age < 0 || age >= s.lifetime) continue;

    // Sine envelope so each streak fades in, holds, fades out smoothly.
    const u = age / s.lifetime;
    const envelope = Math.sin(u * Math.PI);
    const alpha = envelope * WIND_STREAK_ALPHA;
    if (alpha < 0.015) continue;

    const sx = cx + (s.x - bx) * PX_PER_M;
    const sy = cy + (s.y - by) * PX_PER_M;
    const lenPx = s.length * PX_PER_M;
    const tipX = sx + dirX * lenPx;
    const tipY = sy + dirY * lenPx;

    // Cheap viewport cull (after computing screen coords).
    if ((sx < -40 && tipX < -40) || (sx > w + 40 && tipX > w + 40)) continue;
    if ((sy < -40 && tipY < -40) || (sy > h + 40 && tipY > h + 40)) continue;

    // Gradient along the streak — transparent at both ends, brightest in the
    // middle — gives the "comet trail" look common in sailing broadcasts.
    const grad = ctx.createLinearGradient(sx, sy, tipX, tipY);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.35, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
    grad.addColorStop(0.7, `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Wake ----------

function drawWake(ctx, w, h, world) {
  const cx = w / 2;
  const cy = h / 2;
  const bx = world.camera.x;
  const by = world.camera.y;

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

// ---------- Entities (docks + parked boats placed by the map editor) ----------

function drawEntities(ctx, w, h, world) {
  if (!world.entities || world.entities.length === 0) return;
  const cx = w / 2;
  const cy = h / 2;
  const camX = world.camera.x;
  const camY = world.camera.y;

  for (const e of world.entities) {
    const sx = cx + (e.x - camX) * PX_PER_M;
    const sy = cy + (e.y - camY) * PX_PER_M;
    const maxDim = Math.max(e.length, e.width) * PX_PER_M;
    // Generous cull to also cover rotation overshoot.
    if (sx + maxDim < -20 || sx - maxDim > w + 20) continue;
    if (sy + maxDim < -20 || sy - maxDim > h + 20) continue;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(e.heading);

    if (e.category === 'dock') drawDockEntity(ctx, e);
    else if (e.category === 'boat') drawStaticBoatEntity(ctx, e);

    // Selection highlight + rotation-front indicator.
    if (world.edit.mode && world.edit.selectedId === e.id) {
      drawEntitySelectionFrame(ctx, e);
    }

    ctx.restore();
  }
}

function drawDockEntity(ctx, e) {
  const L = e.length * PX_PER_M;
  const W = e.width * PX_PER_M;
  // Wood plank fill.
  const grad = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  grad.addColorStop(0, '#a8845a');
  grad.addColorStop(0.5, '#896944');
  grad.addColorStop(1, '#5e472b');
  ctx.fillStyle = grad;
  ctx.fillRect(-L / 2, -W / 2, L, W);
  ctx.strokeStyle = '#2f2415';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-L / 2, -W / 2, L, W);
  // Plank grain lines along length.
  ctx.strokeStyle = 'rgba(40, 28, 14, 0.45)';
  ctx.lineWidth = 0.6;
  const plankStripe = Math.max(4, W / 5);
  for (let py = -W / 2 + plankStripe; py < W / 2 - 0.5; py += plankStripe) {
    ctx.beginPath();
    ctx.moveTo(-L / 2 + 1, py);
    ctx.lineTo(L / 2 - 1, py);
    ctx.stroke();
  }
  // Cross seams every ~2m.
  ctx.strokeStyle = 'rgba(40, 28, 14, 0.3)';
  const seam = PX_PER_M * 2;
  for (let px = -L / 2 + seam; px < L / 2 - 1; px += seam) {
    ctx.beginPath();
    ctx.moveTo(px, -W / 2);
    ctx.lineTo(px, W / 2);
    ctx.stroke();
  }
  // Chrome cleats near the corners (small markers).
  const cx = L / 2 - Math.min(10, L * 0.08);
  const cy = W / 2 - Math.min(4, W * 0.18);
  if (L > 28) {
    drawDockCleat(ctx,  cx,  cy);
    drawDockCleat(ctx,  cx, -cy);
    drawDockCleat(ctx, -cx,  cy);
    drawDockCleat(ctx, -cx, -cy);
  }
}

function drawDockCleat(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#d8dde4';
  ctx.strokeStyle = '#2a3340';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  roundedRect(ctx, -3, -1, 6, 2, 0.8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawStaticBoatEntity(ctx, e) {
  const L = e.length * PX_PER_M;
  const W = e.width * PX_PER_M;
  if (e.hull === 'cat') drawCatamaranSilhouette(ctx, L, W);
  else drawMonoSilhouette(ctx, L, W, !!e.sail, !!e.cabin);
}

function drawMonoSilhouette(ctx, L, W, hasSail, hasCabin) {
  const half = L / 2;
  const halfW = W / 2;
  // Hull outline — sharp bow, flat transom.
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.bezierCurveTo(half * 0.9, halfW * 0.35, half * 0.55, halfW * 0.9, half * 0.05, halfW * 0.97);
  ctx.quadraticCurveTo(-half * 0.55, halfW * 0.95, -half, halfW * 0.65);
  ctx.lineTo(-half, -halfW * 0.65);
  ctx.quadraticCurveTo(-half * 0.55, -halfW * 0.95, half * 0.05, -halfW * 0.97);
  ctx.bezierCurveTo(half * 0.55, -halfW * 0.9, half * 0.9, -halfW * 0.35, half, 0);
  ctx.closePath();
  const hullGrad = ctx.createLinearGradient(0, -halfW, 0, halfW);
  hullGrad.addColorStop(0, '#d5dbe4');
  hullGrad.addColorStop(0.5, '#eef2f7');
  hullGrad.addColorStop(1, '#b4bdcb');
  ctx.fillStyle = hullGrad;
  ctx.fill();
  ctx.strokeStyle = '#1f2a3a';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // Cockpit/deck inset.
  ctx.beginPath();
  const inX = -L * 0.06;
  ctx.ellipse(inX, 0, half * 0.55, halfW * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2c4760';
  ctx.fill();
  ctx.strokeStyle = '#0c1b2a';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Optional cabin (raised box near amidships).
  if (hasCabin) {
    ctx.beginPath();
    roundedRect(ctx, half * 0.05, -halfW * 0.55, half * 0.45, halfW * 1.1, 3);
    ctx.fillStyle = '#395470';
    ctx.fill();
    ctx.strokeStyle = '#10243a';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // Windows
    ctx.fillStyle = 'rgba(160, 210, 235, 0.7)';
    ctx.fillRect(half * 0.12, -halfW * 0.42, half * 0.32, halfW * 0.16);
    ctx.fillRect(half * 0.12, halfW * 0.26, half * 0.32, halfW * 0.16);
  }
  // Optional sail (triangular jib + mainsail hint).
  if (hasSail) {
    ctx.fillStyle = 'rgba(245, 246, 248, 0.92)';
    ctx.strokeStyle = '#2c3340';
    ctx.lineWidth = 0.7;
    // Mainsail — pointing aft (away from bow).
    ctx.beginPath();
    ctx.moveTo(half * 0.05, 0);
    ctx.lineTo(-half * 0.6, halfW * 0.55);
    ctx.lineTo(-half * 0.6, -halfW * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Mast
    ctx.fillStyle = '#3a3320';
    ctx.beginPath();
    ctx.arc(half * 0.05, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCatamaranSilhouette(ctx, L, W) {
  const half = L / 2;
  const halfW = W / 2;
  const hullHalfW = Math.max(4, halfW * 0.18);
  const offset = halfW - hullHalfW;

  for (const sign of [-1, 1]) {
    const c = sign * offset;
    ctx.beginPath();
    ctx.moveTo(half, c);
    ctx.bezierCurveTo(half * 0.85, c + hullHalfW * 0.4, half * 0.3, c + hullHalfW, -half * 0.7, c + hullHalfW);
    ctx.lineTo(-half, c + hullHalfW * 0.6);
    ctx.lineTo(-half, c - hullHalfW * 0.6);
    ctx.lineTo(-half * 0.7, c - hullHalfW);
    ctx.bezierCurveTo(half * 0.3, c - hullHalfW, half * 0.85, c - hullHalfW * 0.4, half, c);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, c - hullHalfW, 0, c + hullHalfW);
    g.addColorStop(0, '#d5dbe4');
    g.addColorStop(1, '#a9b3c2');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#1f2a3a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Cross deck bridging the hulls.
  ctx.fillStyle = '#3a5876';
  ctx.beginPath();
  roundedRect(ctx, -half * 0.45, -offset + hullHalfW * 0.3, half * 0.9, (offset - hullHalfW * 0.3) * 2, 3);
  ctx.fill();
  ctx.strokeStyle = '#0c1b2a';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Cabin pod centered on bridge deck.
  ctx.fillStyle = '#2c4760';
  ctx.beginPath();
  roundedRect(ctx, -half * 0.2, -offset * 0.55, half * 0.5, offset * 1.1, 3);
  ctx.fill();
  ctx.stroke();
}

function drawEntitySelectionFrame(ctx, e) {
  const L = e.length * PX_PER_M;
  const W = e.width * PX_PER_M;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(255, 220, 90, 0.95)';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(-L / 2 - 3, -W / 2 - 3, L + 6, W + 6);
  ctx.setLineDash([]);
  // Bow marker — small triangle on the +x side so you can see the heading.
  ctx.fillStyle = 'rgba(255, 220, 90, 0.95)';
  ctx.beginPath();
  ctx.moveTo(L / 2 + 10, 0);
  ctx.lineTo(L / 2 + 2, -5);
  ctx.lineTo(L / 2 + 2, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- Edit overlay (instructions on canvas) ----------

function drawEditOverlay(ctx, w, h, world) {
  // Centered crosshair where mouse clicks would land — visual cue for placement.
  // (We don't have mouse coords here, so just draw the camera-centered cue.)
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 220, 90, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(w / 2 - 16, h / 2);
  ctx.lineTo(w / 2 + 16, h / 2);
  ctx.moveTo(w / 2, h / 2 - 16);
  ctx.lineTo(w / 2, h / 2 + 16);
  ctx.stroke();
  ctx.setLineDash([]);

  // Edit-mode hints (bottom-left).
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(230, 244, 251, 0.72)';
  ctx.textAlign = 'left';
  const lines = [
    'EDIT MODE — boat physics paused',
    'W A S D / ←↑→↓   Pan camera',
    'Click             Place / select',
    'Drag              Move selected',
    'Wheel / [  ]      Rotate selected (±15°)',
    'Delete            Remove selected',
    'Esc               Deselect',
  ];
  const x = 16;
  const yTop = h - 16 - (lines.length - 1) * 18 - 6;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, yTop + i * 18);
  }
  ctx.restore();
  void world;
}

// ---------- Boat (small sport bowrider, top-down) ----------

function drawBoat(ctx, w, h, world) {
  const boat = world.boat;
  const cam = world.camera;
  const cx = w / 2 + (boat.x - cam.x) * PX_PER_M;
  const cy = h / 2 + (boat.y - cam.y) * PX_PER_M;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(boat.heading);

  const L = BOAT_LENGTH * PX_PER_M;
  const W = BOAT_WIDTH * PX_PER_M;
  const half = L / 2;
  const halfW = W / 2;

  // Soft shadow underneath the hull for depth against the water.
  ctx.save();
  ctx.translate(0, 2);
  hullOutlinePath(ctx, half * 1.01, halfW * 1.04);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
  ctx.restore();

  // 1) Outboard motor — drawn BEFORE the hull so the transom edge sits on top
  //    of the mount, and so the cowling extends behind the boat cleanly.
  drawOutboardMotor(ctx, half, boat.rudder);

  // 2) Hull — fiberglass white with a side-to-side gradient for shading.
  hullOutlinePath(ctx, half, halfW);
  {
    const grad = ctx.createLinearGradient(0, -halfW, 0, halfW);
    grad.addColorStop(0, '#dde5ef');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#c1cbd8');
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.strokeStyle = '#1a2538';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 3) Boot stripe (navy accent along the hull side).
  ctx.save();
  hullOutlinePath(ctx, half, halfW);
  ctx.clip();
  hullOutlinePath(ctx, half - 2, halfW - 1.8);
  ctx.strokeStyle = '#1f4a76';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();

  // 4) Cockpit interior (dark navy), inset within the hull.
  cockpitPath(ctx, half, halfW);
  ctx.fillStyle = '#1b3552';
  ctx.fill();
  ctx.strokeStyle = '#0c2034';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // 5) Teak deck planks visible inside the cockpit.
  ctx.save();
  cockpitPath(ctx, half, halfW);
  ctx.clip();
  ctx.strokeStyle = 'rgba(190, 145, 80, 0.22)';
  ctx.lineWidth = 0.6;
  for (let i = -4; i <= 4; i++) {
    const py = i * (halfW * 0.2);
    ctx.beginPath();
    ctx.moveTo(-half, py);
    ctx.lineTo(half, py);
    ctx.stroke();
  }
  ctx.restore();

  // 6) Engine compartment at the stern (covers the back portion of cockpit).
  ctx.fillStyle = '#0b1828';
  ctx.strokeStyle = '#04080f';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  roundedRect(ctx, -half * 0.92, -halfW * 0.55, half * 0.22, halfW * 1.1, 3);
  ctx.fill();
  ctx.stroke();
  // Engine cover vents
  ctx.strokeStyle = 'rgba(140, 160, 190, 0.45)';
  ctx.lineWidth = 0.5;
  for (let i = -2; i <= 2; i++) {
    const py = i * 4;
    ctx.beginPath();
    ctx.moveTo(-half * 0.86, py);
    ctx.lineTo(-half * 0.78, py);
    ctx.stroke();
  }

  // 7) Rear bench seat (across the cockpit, just forward of the engine).
  drawBench(ctx, -half * 0.65, halfW * 0.78);

  // 8) Captain (port) and passenger (starboard) seats.
  drawSeat(ctx, -half * 0.18, -halfW * 0.42, halfW * 0.28);
  drawSeat(ctx, -half * 0.18,  halfW * 0.42, halfW * 0.28);

  // 9) Helm console in front of the captain seat (small wheel hint).
  drawHelmConsole(ctx, half, halfW, boat.rudderTarget);

  // 10) Foredeck — the white covered area at the front of the boat.
  foredeckPath(ctx, half, halfW);
  {
    const grad = ctx.createLinearGradient(0, -halfW, 0, halfW);
    grad.addColorStop(0, '#d6dde7');
    grad.addColorStop(0.5, '#f7fafd');
    grad.addColorStop(1, '#c2cbd8');
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20, 36, 56, 0.55)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // 11) Bow non-skid pattern (subtle dotted texture on foredeck near tip).
  ctx.save();
  foredeckPath(ctx, half, halfW);
  ctx.clip();
  ctx.fillStyle = 'rgba(50, 70, 90, 0.18)';
  for (let i = 0; i < 16; i++) {
    const px = half * 0.18 + i * (half * 0.05);
    const py = Math.sin(i * 1.7) * halfW * 0.25;
    ctx.beginPath();
    ctx.arc(px, py, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 12) Anchor locker hatch near the bow tip.
  ctx.fillStyle = 'rgba(80, 95, 115, 0.7)';
  ctx.strokeStyle = 'rgba(20, 30, 45, 0.7)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  roundedRect(ctx, half * 0.58, -3.5, 9, 7, 1.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(190, 200, 215, 0.85)';
  ctx.fillRect(half * 0.58 + 7.5, -0.6, 1.4, 1.2);

  // 13) Windshield — sits at the foredeck/cockpit boundary.
  drawWindshield(ctx, half, halfW);

  // 14) Cleats (mooring fittings) at the gunwale corners.
  drawCleat(ctx, half * 0.45,  halfW * 0.84);
  drawCleat(ctx, half * 0.45, -halfW * 0.84);
  drawCleat(ctx, -half * 0.82,  halfW * 0.88);
  drawCleat(ctx, -half * 0.82, -halfW * 0.88);

  // 15) Navigation lights at the bow (red = port, green = starboard).
  ctx.beginPath();
  ctx.arc(half * 0.78, -halfW * 0.55, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = '#d43030';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 0.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(half * 0.78,  halfW * 0.55, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = '#28b85a';
  ctx.fill();
  ctx.stroke();

  // 16) Pivot-point marker — instantaneous lateral center of rotation.
  const pivotX = lateralPivotBodyX(boat);
  if (pivotX != null) {
    const clamped = Math.max(-half, Math.min(half, pivotX * PX_PER_M));
    ctx.save();
    ctx.fillStyle = 'rgba(255, 215, 90, 0.95)';
    ctx.strokeStyle = 'rgba(120, 70, 20, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(clamped, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ---- Hull / deck path helpers (body frame, +x = bow, +y = starboard) ----

function hullOutlinePath(ctx, half, halfW) {
  ctx.beginPath();
  ctx.moveTo(half, 0); // bow tip
  // Starboard side: tip → bow flare → max beam → stern shoulder → transom
  ctx.bezierCurveTo(
    half * 0.93, halfW * 0.32,
    half * 0.62, halfW * 0.88,
    half * 0.30, halfW * 0.97
  );
  ctx.quadraticCurveTo(
    -half * 0.30, halfW * 1.02,
    -half * 0.78, halfW * 0.94
  );
  ctx.quadraticCurveTo(
    -half * 0.97, halfW * 0.86,
    -half, halfW * 0.68
  );
  // Transom
  ctx.lineTo(-half, -halfW * 0.68);
  // Port side mirror
  ctx.quadraticCurveTo(
    -half * 0.97, -halfW * 0.86,
    -half * 0.78, -halfW * 0.94
  );
  ctx.quadraticCurveTo(
    -half * 0.30, -halfW * 1.02,
    half * 0.30, -halfW * 0.97
  );
  ctx.bezierCurveTo(
    half * 0.62, -halfW * 0.88,
    half * 0.93, -halfW * 0.32,
    half, 0
  );
  ctx.closePath();
}

function cockpitPath(ctx, half, halfW) {
  // Inset rectangle-ish area from just aft of the windshield to just forward
  // of the transom; rounded corners so it follows the gunwale curve.
  ctx.beginPath();
  ctx.moveTo(half * 0.04, halfW * 0.72);
  ctx.lineTo(-half * 0.72, halfW * 0.80);
  ctx.quadraticCurveTo(-half * 0.92, halfW * 0.72, -half * 0.93, halfW * 0.55);
  ctx.lineTo(-half * 0.93, -halfW * 0.55);
  ctx.quadraticCurveTo(-half * 0.92, -halfW * 0.72, -half * 0.72, -halfW * 0.80);
  ctx.lineTo(half * 0.04, -halfW * 0.72);
  ctx.closePath();
}

function foredeckPath(ctx, half, halfW) {
  // V-shaped foredeck from the windshield line forward to the bow tip.
  ctx.beginPath();
  ctx.moveTo(half - 3, 0);
  ctx.bezierCurveTo(
    half * 0.86, halfW * 0.28,
    half * 0.52, halfW * 0.72,
    half * 0.18, halfW * 0.80
  );
  ctx.lineTo(half * 0.04, halfW * 0.72);
  ctx.lineTo(half * 0.04, -halfW * 0.72);
  ctx.lineTo(half * 0.18, -halfW * 0.80);
  ctx.bezierCurveTo(
    half * 0.52, -halfW * 0.72,
    half * 0.86, -halfW * 0.28,
    half - 3, 0
  );
  ctx.closePath();
}

// ---- Boat detail pieces ----

function drawOutboardMotor(ctx, half, rudderActual) {
  // The motor pivots on the transom and steers the boat. It rotates with
  // the actual (smoothed) rudder value — same source as the physics.
  ctx.save();
  ctx.translate(-half, 0);
  ctx.rotate(rudderActual * 0.6); // visual swing up to ~35°

  // Transom bracket (clamps to the hull, sits half over the transom edge).
  ctx.fillStyle = '#2a3445';
  ctx.strokeStyle = '#0a0d14';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.rect(-1.5, -3.5, 5, 7);
  ctx.fill();
  ctx.stroke();

  // Powerhead cowling (engine housing) hanging aft of the bracket.
  ctx.beginPath();
  ctx.ellipse(-11, 0, 7.5, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#161d28';
  ctx.fill();
  ctx.strokeStyle = '#04070d';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Brand color stripe along the cowling.
  ctx.fillStyle = '#d6342e';
  ctx.fillRect(-17.5, -0.8, 13, 1.5);

  // Air intake panel.
  ctx.fillStyle = '#3b4554';
  ctx.beginPath();
  ctx.ellipse(-9, 0, 2.2, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Lower-unit cavitation plate (small horizontal fin under cowling).
  ctx.fillStyle = '#0c1018';
  ctx.fillRect(-15, -0.4, 4, 0.8);

  ctx.restore();
}

function drawSeat(ctx, x, y, size) {
  // x, y is the seat center. Captain faces +x (forward).
  ctx.save();
  ctx.translate(x, y);
  // Backrest (aft end of the seat)
  ctx.fillStyle = '#384354';
  ctx.strokeStyle = '#161e2b';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  roundedRect(ctx, -size * 0.85, -size * 0.5, size * 0.32, size, 1.8);
  ctx.fill();
  ctx.stroke();
  // Cushion
  ctx.fillStyle = '#5a6878';
  ctx.beginPath();
  roundedRect(ctx, -size * 0.55, -size * 0.5, size * 1.05, size, 2);
  ctx.fill();
  ctx.stroke();
  // Cushion seam
  ctx.strokeStyle = 'rgba(20, 30, 45, 0.5)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(-size * 0.2, -size * 0.4);
  ctx.lineTo(-size * 0.2, size * 0.4);
  ctx.stroke();
  ctx.restore();
}

function drawBench(ctx, x, y) {
  // Rear bench seat spanning the width of the cockpit at body-frame x.
  // y is the starboard edge magnitude; bench goes from -y to +y.
  ctx.save();
  ctx.translate(x, 0);
  // Backrest (slim, aft side)
  ctx.fillStyle = '#384354';
  ctx.strokeStyle = '#161e2b';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  roundedRect(ctx, -3.5, -y, 2.5, y * 2, 1);
  ctx.fill();
  ctx.stroke();
  // Cushion (wider)
  ctx.fillStyle = '#5a6878';
  ctx.beginPath();
  roundedRect(ctx, -1, -y * 0.95, 8, y * 1.9, 1.6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHelmConsole(ctx, half, halfW, rudderTarget) {
  ctx.save();
  ctx.translate(-half * 0.04, -halfW * 0.42);
  // Console housing (small dashboard)
  ctx.fillStyle = '#11192a';
  ctx.strokeStyle = '#04070f';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  roundedRect(ctx, -2.5, -halfW * 0.25, 6, halfW * 0.5, 1.5);
  ctx.fill();
  ctx.stroke();
  // Tiny wheel on the console, rotating with the helm.
  ctx.save();
  ctx.translate(0.5, 0);
  ctx.rotate(rudderTarget * HELM_MAX_ANGLE);
  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
  ctx.strokeStyle = '#c8a060';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Two spokes
  ctx.beginPath();
  ctx.moveTo(-2.4, 0); ctx.lineTo(2.4, 0);
  ctx.moveTo(0, -2.4); ctx.lineTo(0, 2.4);
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawWindshield(ctx, half, halfW) {
  ctx.save();
  // Curved frame
  ctx.beginPath();
  ctx.moveTo(half * 0.04, -halfW * 0.72);
  ctx.bezierCurveTo(
    half * 0.18, -halfW * 0.45,
    half * 0.18, halfW * 0.45,
    half * 0.04, halfW * 0.72
  );
  ctx.strokeStyle = '#1a2535';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.stroke();
  // Tinted glass
  ctx.strokeStyle = 'rgba(150, 210, 240, 0.7)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Reflection highlight
  ctx.beginPath();
  ctx.moveTo(half * 0.12, -halfW * 0.3);
  ctx.quadraticCurveTo(half * 0.16, 0, half * 0.12, halfW * 0.05);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
}

function drawCleat(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  // Base plate
  ctx.fillStyle = '#5e6878';
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.4, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Chrome horn (the T-bar)
  ctx.fillStyle = '#dadfe6';
  ctx.strokeStyle = '#2a3340';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  roundedRect(ctx, -3.2, -0.9, 6.4, 1.8, 0.8);
  ctx.fill();
  ctx.stroke();
  // Bright highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillRect(-2.6, -0.7, 5.2, 0.4);
  ctx.restore();
}

// ---------- Helm wheel ----------

function drawHelm(ctx, w, h, boat) {
  const { cx, cy, radius } = helmLayout(w, h);
  const helmAngle = boat.rudderTarget * HELM_MAX_ANGLE;

  ctx.save();

  // Halo shadow under the wheel.
  ctx.beginPath();
  ctx.arc(cx, cy + 4, radius + 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();

  // Compass band behind the wheel — labels stay still while the wheel rotates.
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 22, 0, Math.PI * 2);
  const bandGrad = ctx.createRadialGradient(cx, cy, radius + 6, cx, cy, radius + 22);
  bandGrad.addColorStop(0, 'rgba(8, 22, 32, 0.0)');
  bandGrad.addColorStop(1, 'rgba(8, 22, 32, 0.55)');
  ctx.fillStyle = bandGrad;
  ctx.fill();

  // Fixed reference marker pointing down at the wheel (the "lubber line").
  ctx.fillStyle = 'rgba(225, 240, 250, 0.9)';
  ctx.strokeStyle = 'rgba(40, 60, 80, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 6);
  ctx.lineTo(cx - 6, cy - radius - 18);
  ctx.lineTo(cx + 6, cy - radius - 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Rotating wheel parts.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(helmAngle);

  // Outer rim.
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#5a4423';
  ctx.lineWidth = 11;
  ctx.stroke();
  // Inner/outer edge highlights for depth.
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(20, 12, 4, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius - 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(180, 140, 90, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Spokes — 6, with handles extending past the rim.
  const numSpokes = 6;
  ctx.lineCap = 'round';
  for (let i = 0; i < numSpokes; i++) {
    const a = (i / numSpokes) * Math.PI * 2 - Math.PI / 2; // start at 12 o'clock
    const isKing = i === 0;
    ctx.strokeStyle = isKing ? '#a87a32' : '#5a4423';
    ctx.lineWidth = isKing ? 5.5 : 4.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * (radius + 14), Math.sin(a) * (radius + 14));
    ctx.stroke();
  }

  // Spoke handle balls.
  for (let i = 0; i < numSpokes; i++) {
    const a = (i / numSpokes) * Math.PI * 2 - Math.PI / 2;
    const isKing = i === 0;
    const hx = Math.cos(a) * (radius + 16);
    const hy = Math.sin(a) * (radius + 16);
    const hr = isKing ? 8 : 6.5;
    const g = ctx.createRadialGradient(hx - hr * 0.4, hy - hr * 0.4, 1, hx, hy, hr);
    g.addColorStop(0, isKing ? '#f0c870' : '#8a6a40');
    g.addColorStop(1, isKing ? '#7d5a1f' : '#3a2810');
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#1a0e05';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Center hub.
  const hubR = 14;
  const hubGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, hubR);
  hubGrad.addColorStop(0, '#a8825a');
  hubGrad.addColorStop(1, '#3d2812');
  ctx.beginPath();
  ctx.arc(0, 0, hubR, 0, Math.PI * 2);
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = '#1a0e05';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#d4a747';
  ctx.fill();

  ctx.restore();

  // Status label below the wheel.
  ctx.fillStyle = 'rgba(220, 240, 250, 0.75)';
  ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HELM', cx, cy + radius + 24);

  const deg = Math.round(boat.rudderTarget * 35); // up to ~35° physical rudder
  let order;
  if (Math.abs(deg) < 1) order = 'AMIDSHIPS';
  else if (deg > 0) order = `STBD  ${deg}°`;
  else order = `PORT  ${-deg}°`;
  ctx.fillStyle = '#e6f4fb';
  ctx.font = '11px monospace';
  ctx.fillText(order, cx, cy + radius + 40);

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

  // Marine-control color zones (matches the green-N / red-extreme convention
  // on a real single-lever throttle):
  //   • centre band   → bright green NEUTRAL zone (gearbox disengaged)
  //   • away from N   → orange/red gradient to FULL F / FULL R
  const neutralHalfPx = THROTTLE_NEUTRAL_BAND * trackH * 0.5; // half band in px
  const halfH = trackH / 2;
  const yNeutralTop = trackTop + halfH - neutralHalfPx;
  const yNeutralBot = trackTop + halfH + neutralHalfPx;

  // FULL AHEAD zone (above neutral)
  {
    const fwdGrad = ctx.createLinearGradient(0, trackTop, 0, yNeutralTop);
    fwdGrad.addColorStop(0, 'rgba(214, 64, 50, 0.42)');   // red at FULL AHEAD
    fwdGrad.addColorStop(0.45, 'rgba(220, 140, 60, 0.32)'); // orange middle
    fwdGrad.addColorStop(1, 'rgba(110, 200, 130, 0.22)'); // greenish near N
    ctx.fillStyle = fwdGrad;
    ctx.fillRect(trackLeft - 24, trackTop, trackW + 48, yNeutralTop - trackTop);
  }
  // FULL ASTERN zone (below neutral)
  {
    const revGrad = ctx.createLinearGradient(0, yNeutralBot, 0, trackTop + trackH);
    revGrad.addColorStop(0, 'rgba(110, 200, 130, 0.22)'); // greenish near N
    revGrad.addColorStop(0.55, 'rgba(220, 140, 60, 0.32)'); // orange middle
    revGrad.addColorStop(1, 'rgba(214, 64, 50, 0.42)');   // red at FULL ASTERN
    ctx.fillStyle = revGrad;
    ctx.fillRect(trackLeft - 24, yNeutralBot, trackW + 48, trackTop + trackH - yNeutralBot);
  }

  // Bright GREEN NEUTRAL ZONE — clearly delineated band in the middle. The
  // catch pulse briefly brightens it with a yellow-white halo (the "탁").
  const pulse = Math.max(0, Math.min(1, boat.catchPulse / THROTTLE_CATCH_PULSE_TIME));
  {
    const nGrad = ctx.createLinearGradient(0, yNeutralTop, 0, yNeutralBot);
    nGrad.addColorStop(0,    'rgba(70, 200, 120, 0.38)');
    nGrad.addColorStop(0.5,  `rgba(120, 235, 150, ${(0.62 + pulse * 0.3).toFixed(3)})`);
    nGrad.addColorStop(1,    'rgba(70, 200, 120, 0.38)');
    ctx.fillStyle = nGrad;
    ctx.fillRect(trackLeft - 26, yNeutralTop, trackW + 52, yNeutralBot - yNeutralTop);

    // Boundary lines: solid green stripes marking the edges of N.
    ctx.strokeStyle = 'rgba(110, 230, 140, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(trackLeft - 26, yNeutralTop);
    ctx.lineTo(trackLeft + trackW + 26, yNeutralTop);
    ctx.moveTo(trackLeft - 26, yNeutralBot);
    ctx.lineTo(trackLeft + trackW + 26, yNeutralBot);
    ctx.stroke();
  }
  if (pulse > 0) {
    // Catch flash — quick warm halo around the N band.
    ctx.fillStyle = `rgba(255, 246, 200, ${(pulse * 0.55).toFixed(3)})`;
    ctx.fillRect(
      trackLeft - 32,
      yNeutralTop - 4,
      trackW + 64,
      (yNeutralBot - yNeutralTop) + 8
    );
  }

  // Track itself
  ctx.fillStyle = 'rgba(8, 18, 26, 0.95)';
  ctx.fillRect(trackLeft, trackTop, trackW, trackH);
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(trackLeft, trackTop, trackW, trackH);

  // Intermediate notch lines (2/3, 1/3 each way) for finer reference.
  const minorNotches = [2/3, 1/3, -1/3, -2/3];
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  for (const v of minorNotches) {
    const y = valueToY(v);
    ctx.strokeStyle = 'rgba(180, 200, 215, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(trackLeft - 8, y);
    ctx.lineTo(trackLeft + trackW + 8, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210, 225, 240, 0.5)';
    const label = Math.abs(v) === 1/3 ? '1/3' : '2/3';
    ctx.fillText(label, trackLeft + trackW + 14, y + 3);
  }

  // F / N / R bubble markers on the LEFT of the track — F at top extreme
  // (Full Ahead), R at bottom (Full Astern), N as a green pill in the
  // centre of the neutral band. Mirrors a real single-lever marine throttle.
  const bubbleX = trackCx - 38;
  drawZoneBubble(ctx, bubbleX, valueToY(1),  'F', '#d63a30', '#7a1a14');
  drawZoneBubble(ctx, bubbleX, valueToY(0),  'N', '#3fc070', '#1c5e34');
  drawZoneBubble(ctx, bubbleX, valueToY(-1), 'R', '#d63a30', '#7a1a14');

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

function drawZoneBubble(ctx, x, y, letter, fillColor, strokeColor) {
  ctx.save();
  // Soft shadow under the bubble for depth.
  ctx.beginPath();
  ctx.arc(x, y + 1.5, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  // Bubble body — radial gradient gives it a glassy / button feel.
  const g = ctx.createRadialGradient(x - 3, y - 3.5, 1, x, y, 10.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, fillColor);
  g.addColorStop(1, strokeColor);
  ctx.beginPath();
  ctx.arc(x, y, 10.5, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
  // Letter
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, x, y + 0.6);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function throttleOrder(value) {
  const a = Math.abs(value);
  if (a <= THROTTLE_NEUTRAL_BAND) return 'NEUTRAL';
  const dir = value > 0 ? 'AHEAD' : 'ASTERN';
  if (a > 0.94) return 'FULL ' + dir;
  if (a > 0.78) return dir + ' 3/4';
  if (a > 0.55) return dir + ' 2/3';
  if (a > 0.42) return dir + ' 1/2';
  if (a > 0.22) return dir + ' 1/3';
  return dir + ' SLOW';
}

// ---------- Info panel (speed, heading, rudder) ----------

function drawInfoPanel(ctx, w, h, world) {
  const boat = world.boat;
  const wind = world.wind;
  const windOn = wind && wind.speed > 0.1;

  ctx.save();
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const speedKn = Math.hypot(boat.vx, boat.vy) * M_TO_KN;
  let headingDeg = (boat.heading * 180) / Math.PI;
  headingDeg = ((headingDeg % 360) + 360) % 360;

  const panelW = 230;
  const panelH = windOn ? 132 : 70;
  const px = w - panelW - 16;
  const py = 16;
  roundedRect(ctx, px, py, panelW, panelH, 10);
  ctx.fillStyle = 'rgba(6, 26, 40, 0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.25)';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#e6f4fb';
  ctx.fillText(`Speed   ${speedKn.toFixed(1)} kn`, px + 14, py + 26);
  ctx.fillText(`Heading ${headingDeg.toFixed(0).padStart(3, ' ')}°`, px + 14, py + 50);

  if (windOn) {
    const windKn = wind.speed * M_TO_KN;
    let fromDeg = (wind.fromBearing * 180) / Math.PI;
    fromDeg = ((fromDeg % 360) + 360) % 360;
    const cardinal = bearingToCardinal(fromDeg);

    // Separator
    ctx.strokeStyle = 'rgba(200, 235, 250, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 12, py + 64);
    ctx.lineTo(px + panelW - 12, py + 64);
    ctx.stroke();

    ctx.fillStyle = '#e6f4fb';
    ctx.fillText(
      `Wind    ${windKn.toFixed(0)} kn from ${cardinal}`,
      px + 14,
      py + 86
    );
    ctx.fillStyle = 'rgba(200, 220, 235, 0.6)';
    ctx.font = '11px monospace';
    ctx.fillText(`        ${fromDeg.toFixed(0).padStart(3, ' ')}° true`, px + 14, py + 102);

    // Mini wind compass on the right of the panel
    const compCx = px + panelW - 30;
    const compCy = py + 95;
    const compR = 20;
    ctx.beginPath();
    ctx.arc(compCx, compCy, compR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 235, 250, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // N tick
    ctx.fillStyle = 'rgba(255, 130, 130, 0.95)';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', compCx, compCy - compR + 9);

    // Arrow shows where the wind is BLOWING TO (fromBearing + π).
    const bearingTo = wind.fromBearing + Math.PI;
    const dirX = Math.sin(bearingTo);
    const dirY = -Math.cos(bearingTo);
    const arrLen = compR - 4;
    const tipX = compCx + dirX * arrLen;
    const tipY = compCy + dirY * arrLen;
    const tailX = compCx - dirX * (arrLen - 4);
    const tailY = compCy - dirY * (arrLen - 4);
    ctx.strokeStyle = '#9ed7f8';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    const perpX = -dirY;
    const perpY = dirX;
    ctx.fillStyle = '#9ed7f8';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - dirX * 6 + perpX * 3.5, tipY - dirY * 6 + perpY * 3.5);
    ctx.lineTo(tipX - dirX * 6 - perpX * 3.5, tipY - dirY * 6 - perpY * 3.5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
  void h;
}

function bearingToCardinal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// ---------- Hints ----------

function drawHints(ctx, w, h) {
  ctx.save();
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(230, 244, 251, 0.65)';
  ctx.textAlign = 'left';
  const lines = [
    'W / ↑    Throttle up    (sticky • catches at neutral)',
    'S / ↓    Throttle down  (sticky • catches at neutral)',
    'A / ←    Helm to port   (sticky)',
    'D / →    Helm to stbd   (sticky)',
    'Space    Snap throttle & helm to neutral',
    'Mouse    Drag throttle lever / helm wheel',
    '         (release & re-press W/S to cross neutral)',
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
