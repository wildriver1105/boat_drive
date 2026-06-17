import {
  PX_PER_M,
  M_TO_KN,
  BOAT_LENGTH,
  BOAT_WIDTH,
  HELM_MAX_ANGLE,
  WIND_STREAK_ALPHA,
  THROTTLE_NEUTRAL_BAND,
  THROTTLE_CATCH_PULSE_TIME,
} from './constants.js';
import { throttleLayout, helmLayout, thrusterLayout } from './ui-layout.js';
import { createFx, getVignette } from './fx.js';
import { presetById, findEntityAt, snapDockPose } from './entities.js';
import { BOAT_CLEATS, cleatWorld, anchorWorld, mooringPoints } from './mooring.js';

// Build a renderer bound to a specific canvas. Returns a draw(world) function.
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const fx = createFx();
  fx.patA = ctx.createPattern(fx.noiseA, 'repeat');
  fx.patB = ctx.createPattern(fx.noiseB, 'repeat');
  fx.patC = ctx.createPattern(fx.noiseC, 'repeat');

  function draw(world) {
    const dpr = canvas._dpr || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawSea(ctx, w, h, world, fx);
    drawWindStreaks(ctx, w, h, world);
    drawWake(ctx, w, h, world, fx);
    drawTrack(ctx, w, h, world);
    drawEntities(ctx, w, h, world);
    drawMooringLines(ctx, w, h, world); // ropes pass under the hull
    drawBoat(ctx, w, h, world);
    if (world.edit.mode) drawPlacementGhost(ctx, w, h, world);
    // Atmosphere pass: vignette + sun glare over the world, under the HUD.
    ctx.drawImage(getVignette(fx, w, h), 0, 0, w, h);
    if (!world.edit.mode) {
      drawHelm(ctx, w, h, world.boat);
      drawThrottleHandle(ctx, w, h, world.boat);
      drawThrusterPanel(ctx, w, h, world.boat, world.time);
      drawHints(ctx, w, h);
    } else {
      drawEditOverlay(ctx, w, h, world);
    }
    drawInfoPanel(ctx, w, h, world);
    // Mooring cleat markers / drag aids — TOPMOST so the stern cleats aren't
    // hidden behind the hull, cockpit, or the helm HUD. Clicks on a cleat
    // still beat the HUD in the input layer.
    drawMooringAids(ctx, w, h, world);
  }

  // Controls-only overlay for the 3D views: a transparent layer with just the
  // helm / throttle / thruster widgets + HUD, drawn ON TOP of the WebGL
  // canvas. Reuses the exact same hit-tested widgets the input layer drives,
  // so they're mouse-controllable from the cockpit just like in 2D.
  function drawControlsOnly(world) {
    const dpr = canvas._dpr || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawHelm(ctx, w, h, world.boat);
    drawThrottleHandle(ctx, w, h, world.boat);
    drawThrusterPanel(ctx, w, h, world.boat, world.time);
    drawInfoPanel(ctx, w, h, world);
  }

  return { draw, drawControlsOnly };
}

// ---------- Sea ----------

function drawSea(ctx, w, h, world, fx) {
  const t = world.time;
  const cam = world.camera;
  const camPxX = cam.x * PX_PER_M;
  const camPxY = cam.y * PX_PER_M;
  const windSpeed = world.wind ? world.wind.speed : 0;

  // Deep-water base: vertical gradient (horizon-darker top → warmer near
  // water) layered with a radial brightening around the camera so the patch
  // of sea under the boat reads as lit and the distance falls into depth.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#072c43');
  grad.addColorStop(0.5, '#0a4866');
  grad.addColorStop(1, '#0d6186');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const depth = ctx.createRadialGradient(
    w * 0.5, h * 0.5, Math.min(w, h) * 0.1,
    w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62
  );
  depth.addColorStop(0, 'rgba(70, 150, 180, 0.22)');
  depth.addColorStop(0.55, 'rgba(20, 80, 110, 0.05)');
  depth.addColorStop(1, 'rgba(2, 18, 32, 0.42)');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, w, h);

  // Three pre-rendered noise scales, world-anchored, each drifting in its own
  // direction and speed. Their interference — slow swell under fast ripples —
  // is the Canvas-2D stand-in for a layered water shader.
  drawTileLayer(ctx, fx, fx.patC, w, h, -camPxX + t * 1.4, -camPxY + t * 0.9, 3.2, 0.42);
  drawTileLayer(ctx, fx, fx.patB, w, h, -camPxX - t * 2.7, -camPxY + t * 5.4, 1.9, 0.5);
  drawTileLayer(ctx, fx, fx.patA, w, h, -camPxX + t * 4.6, -camPxY + t * 2.3, 1.0, 0.5);
  // A second pass of the fine layer, mirrored drift, adds cross-chop.
  drawTileLayer(ctx, fx, fx.patA, w, h, -camPxX * 1.0 - t * 3.3, -camPxY - t * 4.1, 1.35, 0.3);

  // Specular sun sheen from the upper-right — a soft bright band that makes
  // the surface look lit from a low sun. Drawn with 'lighter' for glow.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sheen = ctx.createLinearGradient(w, 0, w * 0.25, h);
  sheen.addColorStop(0, 'rgba(255, 244, 210, 0.10)');
  sheen.addColorStop(0.35, 'rgba(190, 230, 245, 0.05)');
  sheen.addColorStop(0.7, 'rgba(190, 230, 245, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Long soft swell crests rolling slowly through the scene.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#d7f1fb';
  const bandSpacing = 150;
  let bandOff = (camPxY - t * 12) % bandSpacing;
  if (bandOff < 0) bandOff += bandSpacing;
  for (let i = -1; i < Math.ceil(h / bandSpacing) + 1; i++) {
    const y = i * bandSpacing - bandOff + Math.sin(t * 0.45 + i * 1.3) * 11;
    ctx.fillRect(0, y, w, 2.5);
  }
  ctx.restore();

  // World-anchored twinkling sun sparkles, brighter toward the sun side.
  drawSparkles(ctx, w, h, camPxX, camPxY, t);

  // Whitecaps — breaking foam crests that appear as the wind picks up.
  drawWhitecaps(ctx, w, h, camPxX, camPxY, t, windSpeed, fx);
}

// Wind-driven breaking crests. Each ~150px world cell may own one whitecap
// whose appearance is gated by wind strength and a per-cell phase, then it
// flares and fades. World-anchored so they scroll naturally with the sea.
function drawWhitecaps(ctx, w, h, camPxX, camPxY, t, windSpeed, fx) {
  // Below a light breeze the sea has essentially no breaking crests.
  const windFactor = Math.max(0, Math.min(1, (windSpeed - 3.5) / 9));
  if (windFactor <= 0) return;

  const G = 150;
  const left = camPxX - w / 2;
  const top = camPxY - h / 2;
  const gx0 = Math.floor(left / G) - 1;
  const gy0 = Math.floor(top / G) - 1;
  const gx1 = Math.floor((left + w) / G) + 1;
  const gy1 = Math.floor((top + h) / G) + 1;

  ctx.save();
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const hsh = Math.sin(gx * 91.7 + gy * 47.3) * 23117.13;
      const r1 = hsh - Math.floor(hsh);
      // Only the densest r1 cells host caps; threshold drops as wind rises.
      if (r1 > 0.15 + windFactor * 0.55) continue;
      const hsh2 = Math.sin(gx * 13.1 + gy * 71.9) * 9931.7;
      const r2 = hsh2 - Math.floor(hsh2);
      const hsh3 = Math.sin(gx * 51.3 + gy * 19.7) * 1277.3;
      const r3 = hsh3 - Math.floor(hsh3);
      // Lifecycle: each cap flares over a short window on its own cycle.
      const period = 3.5 + r2 * 3;
      const u = (((t / period + r3) % 1) + 1) % 1;
      const env = Math.sin(u * Math.PI);
      if (env < 0.25) continue;
      const a = (env - 0.25) / 0.75 * 0.5 * windFactor;
      const cellX = gx * G + (0.2 + r2 * 0.6) * G - left;
      const cellY = gy * G + (0.2 + r1 / 0.7 * 0.6) * G - top;
      const size = (10 + r2 * 16) * (0.5 + env * 0.5);
      ctx.globalAlpha = a;
      ctx.drawImage(fx.foam, cellX - size / 2, cellY - size / 2, size, size * 0.7);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Fill the viewport with a repeating pre-rendered tile, offset by (offX, offY)
// screen pixels and scaled. The offset is reduced modulo the tile period so
// coordinates stay small no matter how far the boat travels.
function drawTileLayer(ctx, fx, pattern, w, h, offX, offY, scale, alpha) {
  if (!pattern) return;
  const tile = fx.tileSize * scale;
  const mx = ((offX % tile) + tile) % tile;
  const my = ((offY % tile) + tile) % tile;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(mx - tile, my - tile);
  ctx.scale(scale, scale);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, (w + 2 * tile) / scale, (h + 2 * tile) / scale);
  ctx.restore();
}

// Stable grid-hash sparkles: each ~96px world cell owns one glint with its
// own phase. They twinkle in place and scroll with the world — cheap and
// far more convincing than screen-space drifting dashes.
function drawSparkles(ctx, w, h, camPxX, camPxY, t) {
  const G = 96;
  const left = camPxX - w / 2;
  const top = camPxY - h / 2;
  const gx0 = Math.floor(left / G) - 1;
  const gy0 = Math.floor(top / G) - 1;
  const gx1 = Math.floor((left + w) / G) + 1;
  const gy1 = Math.floor((top + h) / G) + 1;

  ctx.save();
  ctx.strokeStyle = '#eaf8ff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.1;
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const n1 = Math.sin(gx * 127.1 + gy * 311.7) * 43758.5453;
      const h1 = n1 - Math.floor(n1);
      const n2 = Math.sin(gx * 269.5 + gy * 183.3) * 28001.8384;
      const h2 = n2 - Math.floor(n2);
      const tw = Math.sin(t * (0.8 + h2 * 1.6) + h1 * 6.283);
      if (tw < 0.55) continue;
      const sx = gx * G + h1 * G - left;
      const sy = gy * G + h2 * G - top;
      // Sun glitter: brighter toward the upper-right (the sun side).
      const sun = 0.45 + 0.55 * ((sx / w) * 0.6 + (1 - sy / h) * 0.4);
      const a = ((tw - 0.55) / 0.45) ** 2 * 0.6 * Math.max(0.25, Math.min(1, sun));
      const r = 1.5 + h2 * 2.5;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(sx - r, sy);
      ctx.lineTo(sx + r, sy);
      ctx.moveTo(sx, sy - r * 0.7);
      ctx.lineTo(sx, sy + r * 0.7);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
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

function drawWake(ctx, w, h, world, fx) {
  const cx = w / 2;
  const cy = h / 2;
  const camX = world.camera.x;
  const camY = world.camera.y;
  const t = world.time;

  ctx.save();
  for (const p of world.wake) {
    const age = t - p.born;
    const u = age / p.lifetime;
    if (u <= 0 || u >= 1) continue;
    // Quick fade-in, slow fade-out.
    const env = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
    const sizeM = p.size0 + p.grow * age;
    const px = cx + (p.x - camX) * PX_PER_M;
    const py = cy + (p.y - camY) * PX_PER_M;
    const r = sizeM * PX_PER_M;
    if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
    ctx.globalAlpha = p.alpha * env;
    ctx.drawImage(fx.foam, px - r, py - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------- Tracking mode (F1-style racing-line review) ----------

function drawTrack(ctx, w, h, world) {
  const tr = world.track;
  if (!tr || (tr.path.length < 2 && tr.ghosts.length === 0)) return;
  const cx = w / 2;
  const cy = h / 2;
  const camX = world.camera.x;
  const camY = world.camera.y;

  // Continuous path — a glowing cyan racing line.
  if (tr.path.length >= 2) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Soft underglow.
    ctx.strokeStyle = 'rgba(80, 210, 255, 0.18)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let i = 0; i < tr.path.length; i++) {
      const p = tr.path[i];
      const px = cx + (p.x - camX) * PX_PER_M;
      const py = cy + (p.y - camY) * PX_PER_M;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Bright core.
    ctx.strokeStyle = 'rgba(140, 235, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Pose ghosts — translucent hull silhouettes at the recorded heading, so
  // the drift (stern sliding wide of the path) is visible. Older = fainter.
  const half = (BOAT_LENGTH * PX_PER_M) / 2;
  const halfW = (BOAT_WIDTH * PX_PER_M) / 2;
  const n = tr.ghosts.length;
  for (let i = 0; i < n; i++) {
    const g = tr.ghosts[i];
    const px = cx + (g.x - camX) * PX_PER_M;
    const py = cy + (g.y - camY) * PX_PER_M;
    if (px < -half || px > w + half || py < -half || py > h + half) continue;
    const fade = 0.25 + 0.6 * (i / Math.max(1, n - 1)); // newer brighter
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(g.heading);
    hullOutlinePath(ctx, half, halfW);
    ctx.fillStyle = `rgba(255, 230, 130, ${(0.1 + fade * 0.16).toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 220, 90, ${(0.3 + fade * 0.55).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Bow tick to read direction the hull was pointing.
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half + 6, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Mooring lines ----------

function drawMooringLines(ctx, w, h, world) {
  const mo = world.mooring;
  if (!mo) return;
  const cx = w / 2;
  const cy = h / 2;
  const camX = world.camera.x;
  const camY = world.camera.y;
  const toS = (wx, wy) => [cx + (wx - camX) * PX_PER_M, cy + (wy - camY) * PX_PER_M];

  // Existing lines — red when taut, amber when slack.
  for (const line of mo.lines) {
    const cw = cleatWorld(world.boat, line);
    const a = anchorWorld(world, line);
    if (!a) continue;
    const dist = Math.hypot(a.x - cw.x, a.y - cw.y);
    const taut = dist > line.restLength + 0.05;
    const [x1, y1] = toS(cw.x, cw.y);
    const [x2, y2] = toS(a.x, a.y);
    ctx.save();
    ctx.lineCap = 'round';
    if (taut) {
      ctx.strokeStyle = 'rgba(255, 90, 70, 0.95)';
      ctx.lineWidth = 2.6;
    } else {
      // Slack line sags toward the midpoint.
      ctx.strokeStyle = 'rgba(235, 210, 150, 0.85)';
      ctx.lineWidth = 2;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (!taut) {
      const sag = (line.restLength - dist) * PX_PER_M * 0.25;
      ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + Math.min(40, Math.max(6, sag)), x2, y2);
    } else {
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    // Anchor knot.
    ctx.fillStyle = 'rgba(255, 240, 210, 0.95)';
    ctx.beginPath();
    ctx.arc(x2, y2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Mooring-mode aids, drawn ON TOP of the boat: cleat markers, reachable dock/
// bollard points, and the live drag line.
function drawMooringAids(ctx, w, h, world) {
  const mo = world.mooring;
  if (!mo || !mo.mode) return;
  const cx = w / 2;
  const cy = h / 2;
  const camX = world.camera.x;
  const camY = world.camera.y;
  const toS = (wx, wy) => [cx + (wx - camX) * PX_PER_M, cy + (wy - camY) * PX_PER_M];

  // Boat cleats — a prominent ringed dot so even stern cleats over the dark
  // cockpit are unmistakable. The dot the mouse is hovering pulses.
  for (const c of BOAT_CLEATS) {
    const cw = cleatWorld(world.boat, c);
    const [sx, sy] = toS(cw.x, cw.y);
    // Soft glow halo.
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 13);
    glow.addColorStop(0, 'rgba(120, 230, 255, 0.55)');
    glow.addColorStop(1, 'rgba(120, 230, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, 13, 0, Math.PI * 2);
    ctx.fill();
    // White outer ring + cyan core.
    ctx.beginPath();
    ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120, 230, 255, 0.98)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 30, 45, 0.95)';
    ctx.fill();
  }
  // Reachable dock / bollard mooring points.
  for (const pt of mooringPoints(world)) {
    const [sx, sy] = toS(pt.wx, pt.wy);
    if (sx < -14 || sx > w + 14 || sy < -14 || sy > h + 14) continue;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 11);
    glow.addColorStop(0, 'rgba(255, 215, 110, 0.5)');
    glow.addColorStop(1, 'rgba(255, 215, 110, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 220, 120, 0.98)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(70, 45, 10, 0.9)';
    ctx.stroke();
  }
  if (mo.drag) {
    const cw = cleatWorld(world.boat, mo.drag.cleat);
    const [x1, y1] = toS(cw.x, cw.y);
    const [x2, y2] = toS(mo.drag.x, mo.drag.y);
    // Highlight a snap target near the cursor.
    let snap = null;
    let bestD = 1e9;
    for (const pt of mooringPoints(world)) {
      const dd = Math.hypot(pt.wx - mo.drag.x, pt.wy - mo.drag.y);
      if (dd < bestD) { bestD = dd; snap = pt; }
    }
    const within = snap && bestD <= 6;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = within ? 'rgba(120, 240, 150, 0.95)' : 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (within) {
      const [tx, ty] = toS(snap.wx, snap.wy);
      ctx.lineTo(tx, ty);
    } else {
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (within) {
      const [tx, ty] = toS(snap.wx, snap.wy);
      ctx.beginPath();
      ctx.arc(tx, ty, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120, 240, 150, 0.95)';
      ctx.stroke();
    }
    ctx.restore();
  }
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
    else if (e.category === 'bollard') drawBollardEntity(ctx, e);
    else if (e.category === 'buoy') drawBuoyEntity(ctx, e, world.time);
    else if (e.category === 'boat') drawStaticBoatEntity(ctx, e);

    // Selection highlight + heading indicator.
    if (world.edit.mode && world.edit.selectedId === e.id) {
      drawEntitySelectionFrame(ctx, e);
    }

    ctx.restore();
  }
}

function drawDockEntity(ctx, e) {
  const L = e.length * PX_PER_M;
  const W = e.width * PX_PER_M;
  // Drop shadow on the water under the deck.
  ctx.save();
  ctx.translate(2.5, 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(-L / 2, -W / 2, L, W);
  ctx.restore();
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
  // Pilings — wooden posts at the corners (mid-span too on long docks).
  const pilingXs = [-L / 2 + 4, L / 2 - 4];
  if (L > 120) pilingXs.push(0);
  for (const px of pilingXs) {
    for (const py of [-W / 2, W / 2]) {
      const pg = ctx.createRadialGradient(px - 1.2, py - 1.2, 0.5, px, py, 4.5);
      pg.addColorStop(0, '#a8845a');
      pg.addColorStop(1, '#3c2c18');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#170f06';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
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

// ---------- Buoys (anchored navigation marks) ----------

const BUOY_COLORS = {
  'buoy-red':     { hi: '#ff8a7a', main: '#d63030', dark: '#7e1612', top: '#f4f6f8' },
  'buoy-green':   { hi: '#7fe2a8', main: '#1f9e54', dark: '#0c5e2e', top: '#f4f6f8' },
  'buoy-yellow':  { hi: '#ffe9a0', main: '#e8c33a', dark: '#8f7212', top: '#1c2630' },
  'buoy-mooring': { hi: '#ffffff', main: '#e8ecf0', dark: '#9aa6b2', top: '#2a6fd6' },
};

function drawBollardEntity(ctx, e) {
  const r = (e.length * PX_PER_M) / 2;
  // Water shadow.
  ctx.beginPath();
  ctx.arc(1.2, 1.8, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  // Cast-iron post (radial gradient).
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.2, 0, 0, r);
  g.addColorStop(0, '#5a626c');
  g.addColorStop(1, '#1c2127');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#0a0d11';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Bevelled cap + a yellow safety band.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(230, 190, 60, 0.9)';
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = '#3a424c';
  ctx.fill();
}

function drawBuoyEntity(ctx, e, time) {
  const r = (e.length * PX_PER_M) / 2;

  // Lighthouse / channel beacon — a tower with a flashing light.
  if (e.beacon) {
    // Water shadow.
    ctx.beginPath();
    ctx.arc(2, 3, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    // Base platform.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#5b6672';
    ctx.fill();
    ctx.strokeStyle = '#222a33';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Tower (top-down: concentric red/white rings).
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f6f8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = '#cf2f2a';
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.stroke();
    // Flashing lantern.
    const flash = 0.5 + 0.5 * Math.sin(time * 3.5);
    const lr = r * 0.3;
    if (flash > 0.45) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.8);
      glow.addColorStop(0, `rgba(255, 240, 170, ${(0.5 * (flash - 0.45) / 0.55).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255, 240, 170, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, lr, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0.45 ? '#fff3b0' : '#7a6a2a';
    ctx.fill();
    return;
  }

  const color = BUOY_COLORS[e.presetId] || BUOY_COLORS['buoy-yellow'];

  // Bobbing ripple — an expanding, fading ring with a per-buoy phase, so a
  // field of buoys doesn't pulse in lockstep.
  const phase = entityHash01(e, 13);
  const period = 2.6;
  const u = (((time / period + phase) % 1) + 1) % 1;
  const ringR = r * (1.2 + u * 1.3);
  const ringA = 0.28 * (1 - u);
  if (ringA > 0.01) {
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(234, 246, 251, ${ringA.toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Shadow on the water.
  ctx.beginPath();
  ctx.arc(1.5, 2.5, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fill();

  // Body — radial gradient for a rounded float.
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.15, 0, 0, r);
  g.addColorStop(0, color.hi);
  g.addColorStop(0.55, color.main);
  g.addColorStop(1, color.dark);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 14, 20, 0.75)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Top band / topmark.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = color.top;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // Lifting eye at the center.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#222a33';
  ctx.fill();
}

function drawStaticBoatEntity(ctx, e) {
  const L = e.length * PX_PER_M;
  const W = e.width * PX_PER_M;
  const half = L / 2;
  const halfW = W / 2;
  const accent = pickAccent(e);
  const rig = e.sail === true ? 'sloop' : e.sail;

  // Hull-shaped soft shadow on the water.
  ctx.save();
  ctx.translate(2.2, 3.8);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  if (e.hull === 'cat') {
    const hullHalfW = Math.max(5, halfW * 0.17);
    const off = halfW - hullHalfW;
    catHullPath(ctx, half, hullHalfW, -off);
    ctx.fill();
    catHullPath(ctx, half, hullHalfW, off);
    ctx.fill();
  } else if (rig) {
    sailHullPath(ctx, half, halfW);
    ctx.fill();
  } else {
    entityHullPath(ctx, half, halfW);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  if (e.hull === 'cat') drawCatamaranTop(ctx, L, W, accent);
  else if (rig) drawSailboatTop(ctx, L, W, rig, accent);
  else drawMotorboatTop(ctx, L, W, e, accent);
}

// Stable per-entity hull color so a marina full of boats doesn't look like
// clones. Hash of the entity id picks from a small paint palette.
const HULL_PALETTES = [
  { top: '#e8edf3', mid: '#ffffff', low: '#bfc9d6', stripe: '#1f4a76' }, // white / navy
  { top: '#e8edf3', mid: '#fdfefe', low: '#bcc7d4', stripe: '#8f2422' }, // white / red
  { top: '#2c5577', mid: '#3e6e96', low: '#1b3a55', stripe: '#e9f0f6' }, // navy hull
  { top: '#7c2730', mid: '#94333d', low: '#581a21', stripe: '#f0e7d4' }, // burgundy hull
  { top: '#23635a', mid: '#2f7d71', low: '#174740', stripe: '#ece4cf' }, // racing green
  { top: '#efe9d6', mid: '#f9f5e8', low: '#cfc6ab', stripe: '#26425e' }, // cream / navy
];

function entityHash01(e, salt) {
  let h = 2166136261 ^ salt;
  const s = String(e.id || e.presetId || 'x');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1000) / 1000;
}

function pickAccent(e) {
  const idx = Math.floor(entityHash01(e, 7) * HULL_PALETTES.length);
  return HULL_PALETTES[idx % HULL_PALETTES.length];
}

// ---- Entity hull outline paths (body frame, +x = bow) ----

// Planing motorboat: full bow flare, beamy midships, flat transom.
function entityHullPath(ctx, half, halfW) {
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.bezierCurveTo(half * 0.92, halfW * 0.38, half * 0.55, halfW * 0.92, half * 0.1, halfW * 0.98);
  ctx.quadraticCurveTo(-half * 0.5, halfW * 1.0, -half * 0.85, halfW * 0.88);
  ctx.quadraticCurveTo(-half, halfW * 0.78, -half, halfW * 0.6);
  ctx.lineTo(-half, -halfW * 0.6);
  ctx.quadraticCurveTo(-half, -halfW * 0.78, -half * 0.85, -halfW * 0.88);
  ctx.quadraticCurveTo(-half * 0.5, -halfW * 1.0, half * 0.1, -halfW * 0.98);
  ctx.bezierCurveTo(half * 0.55, -halfW * 0.92, half * 0.92, -halfW * 0.38, half, 0);
  ctx.closePath();
}

// Sailing yacht: finer entry, max beam aft of midships, narrow counter stern.
function sailHullPath(ctx, half, halfW) {
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.bezierCurveTo(half * 0.82, halfW * 0.5, half * 0.28, halfW * 0.96, -half * 0.15, halfW * 0.94);
  ctx.quadraticCurveTo(-half * 0.7, halfW * 0.78, -half, halfW * 0.4);
  ctx.lineTo(-half, -halfW * 0.4);
  ctx.quadraticCurveTo(-half * 0.7, -halfW * 0.78, -half * 0.15, -halfW * 0.94);
  ctx.bezierCurveTo(half * 0.28, -halfW * 0.96, half * 0.82, -halfW * 0.5, half, 0);
  ctx.closePath();
}

// Single catamaran hull (slender) centered on body-frame y = cy.
function catHullPath(ctx, half, hullHalfW, cy) {
  ctx.beginPath();
  ctx.moveTo(half, cy);
  ctx.bezierCurveTo(half * 0.85, cy + hullHalfW * 0.45, half * 0.3, cy + hullHalfW, -half * 0.7, cy + hullHalfW);
  ctx.quadraticCurveTo(-half * 0.95, cy + hullHalfW * 0.9, -half, cy + hullHalfW * 0.55);
  ctx.lineTo(-half, cy - hullHalfW * 0.55);
  ctx.quadraticCurveTo(-half * 0.95, cy - hullHalfW * 0.9, -half * 0.7, cy - hullHalfW);
  ctx.bezierCurveTo(half * 0.3, cy - hullHalfW, half * 0.85, cy - hullHalfW * 0.45, half, cy);
  ctx.closePath();
}

// ---- Shared entity hardware ----

function drawTinyCleat(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#dadfe6';
  ctx.strokeStyle = '#2a3340';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  roundedRect(ctx, -2.4, -0.8, 4.8, 1.6, 0.7);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawParkedOutboard(ctx, half) {
  ctx.save();
  ctx.translate(-half, 0);
  ctx.beginPath();
  roundedRect(ctx, -9, -3.4, 8.4, 6.8, 2.4);
  const g = ctx.createLinearGradient(0, -3.4, 0, 3.4);
  g.addColorStop(0, '#2e3a48');
  g.addColorStop(1, '#10161e');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#05080d';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = '#d6342e';
  ctx.fillRect(-8.4, -0.7, 7.2, 1.4);
  ctx.restore();
}

function drawEntitySeat(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#384354';
  ctx.strokeStyle = '#141c28';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  roundedRect(ctx, -s * 0.8, -s * 0.5, s * 0.3, s, 1.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5a6878';
  ctx.beginPath();
  roundedRect(ctx, -s * 0.5, -s * 0.5, s, s, 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMotorboatTop(ctx, L, W, e, accent) {
  const half = L / 2;
  const halfW = W / 2;
  const hasCabin = !!e.cabin;

  // Outboard motor for open boats (under the transom edge).
  if (!hasCabin) drawParkedOutboard(ctx, half);

  // Hull topsides.
  entityHullPath(ctx, half, halfW);
  const g = ctx.createLinearGradient(0, -halfW, 0, halfW);
  g.addColorStop(0, accent.top);
  g.addColorStop(0.5, accent.mid);
  g.addColorStop(1, accent.low);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(14, 22, 34, 0.9)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Rubrail stripe + gloss highlight, clipped to the hull.
  ctx.save();
  entityHullPath(ctx, half, halfW);
  ctx.clip();
  entityHullPath(ctx, half - 2, halfW - 1.6);
  ctx.strokeStyle = accent.stripe;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(half * 0.78, -halfW * 0.28);
  ctx.quadraticCurveTo(0, -halfW * 0.8, -half * 0.8, -halfW * 0.55);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  if (hasCabin) drawCruiserTopsides(ctx, half, halfW, e);
  else drawOpenBoatTopsides(ctx, half, halfW, e);

  // Corner cleats.
  drawTinyCleat(ctx, half * 0.5, halfW * 0.8);
  drawTinyCleat(ctx, half * 0.5, -halfW * 0.8);
  drawTinyCleat(ctx, -half * 0.8, halfW * 0.78);
  drawTinyCleat(ctx, -half * 0.8, -halfW * 0.78);
}

// Open motorboats: dinghy (bench thwarts) and runabout (windshield + seats).
function drawOpenBoatTopsides(ctx, half, halfW, e) {
  const isRunabout = e.length >= 5;
  const fdAft = isRunabout ? half * 0.2 : half * 0.45;

  // Cockpit floor.
  ctx.beginPath();
  roundedRect(ctx, -half * 0.86, -halfW * 0.68, fdAft + half * 0.86 - 2, halfW * 1.36, 5);
  ctx.fillStyle = '#26405b';
  ctx.fill();
  ctx.strokeStyle = '#0d1f31';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Foredeck wedge with center seam.
  ctx.beginPath();
  ctx.moveTo(half - 1.5, 0);
  ctx.bezierCurveTo(half * 0.85, halfW * 0.32, half * 0.55, halfW * 0.72, fdAft, halfW * 0.7);
  ctx.lineTo(fdAft, -halfW * 0.7);
  ctx.bezierCurveTo(half * 0.55, -halfW * 0.72, half * 0.85, -halfW * 0.32, half - 1.5, 0);
  ctx.closePath();
  const fg = ctx.createLinearGradient(0, -halfW, 0, halfW);
  fg.addColorStop(0, '#dde4ec');
  fg.addColorStop(0.5, '#f4f8fb');
  fg.addColorStop(1, '#c3cdd9');
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20, 36, 56, 0.5)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(half - 3, 0);
  ctx.lineTo(fdAft + 2, 0);
  ctx.strokeStyle = 'rgba(20, 36, 56, 0.3)';
  ctx.stroke();

  if (isRunabout) {
    // Curved windshield at the cockpit front.
    ctx.beginPath();
    ctx.moveTo(fdAft, -halfW * 0.66);
    ctx.bezierCurveTo(fdAft + half * 0.1, -halfW * 0.4, fdAft + half * 0.1, halfW * 0.4, fdAft, halfW * 0.66);
    ctx.strokeStyle = '#16242f';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150, 205, 235, 0.75)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // Helm console (port side, just aft of the windshield).
    ctx.fillStyle = '#11192a';
    ctx.strokeStyle = '#04070f';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    roundedRect(ctx, fdAft - half * 0.14, -halfW * 0.5, half * 0.1, halfW * 0.32, 1.5);
    ctx.fill();
    ctx.stroke();
    // Captain + passenger seats, stern bench.
    drawEntitySeat(ctx, -half * 0.08, -halfW * 0.36, halfW * 0.4);
    drawEntitySeat(ctx, -half * 0.08, halfW * 0.36, halfW * 0.4);
    ctx.fillStyle = '#5a6878';
    ctx.strokeStyle = '#141c28';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    roundedRect(ctx, -half * 0.8, -halfW * 0.5, half * 0.12, halfW, 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // Dinghy: two wooden thwart benches across the hull.
    ctx.fillStyle = '#b8915a';
    ctx.strokeStyle = '#4a3318';
    ctx.lineWidth = 0.6;
    for (const tx of [half * 0.05, -half * 0.45]) {
      ctx.beginPath();
      roundedRect(ctx, tx - 2.2, -halfW * 0.6, 4.4, halfW * 1.2, 1.5);
      ctx.fill();
      ctx.stroke();
    }
  }
}

// Cabin cruisers and yachts: superstructure, glass, rails, radar arch.
function drawCruiserTopsides(ctx, half, halfW, e) {
  const isYacht = e.length >= 15;

  // Aft cockpit.
  ctx.beginPath();
  roundedRect(ctx, -half * 0.86, -halfW * 0.6, half * 0.36, halfW * 1.2, 4);
  ctx.fillStyle = '#243c55';
  ctx.fill();
  ctx.strokeStyle = '#0d1f31';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Stern bench.
  ctx.fillStyle = '#5a6878';
  ctx.strokeStyle = '#141c28';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  roundedRect(ctx, -half * 0.84, -halfW * 0.48, half * 0.08, halfW * 0.96, 2);
  ctx.fill();
  ctx.stroke();

  // Foredeck seam, anchor hatch, skylight hatches.
  ctx.strokeStyle = 'rgba(20, 36, 56, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(half * 0.96, 0);
  ctx.lineTo(half * 0.38, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(70, 88, 108, 0.7)';
  ctx.strokeStyle = 'rgba(15, 26, 40, 0.7)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  roundedRect(ctx, half * 0.74, -halfW * 0.12, half * 0.12, halfW * 0.24, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(140, 190, 220, 0.55)';
  ctx.beginPath();
  roundedRect(ctx, half * 0.5, -halfW * 0.18, half * 0.1, halfW * 0.36, 2);
  ctx.fill();
  ctx.stroke();
  if (isYacht) {
    ctx.beginPath();
    roundedRect(ctx, half * 0.62, -halfW * 0.18, half * 0.08, halfW * 0.36, 2);
    ctx.fill();
    ctx.stroke();
  }

  // Cabin superstructure.
  const cabFwd = half * 0.34;
  const cabAft = -half * 0.48;
  const cabHalf = halfW * 0.7;
  ctx.beginPath();
  roundedRect(ctx, cabAft, -cabHalf, cabFwd - cabAft, cabHalf * 2, 6);
  const cg = ctx.createLinearGradient(0, -cabHalf, 0, cabHalf);
  cg.addColorStop(0, '#eef1f5');
  cg.addColorStop(0.5, '#f9fbfd');
  cg.addColorStop(1, '#c7d1dd');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 30, 44, 0.8)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Raked front windshield (curved glass band).
  ctx.beginPath();
  ctx.moveTo(cabFwd - 1, -cabHalf * 0.85);
  ctx.quadraticCurveTo(cabFwd + half * 0.09, 0, cabFwd - 1, cabHalf * 0.85);
  ctx.strokeStyle = '#16242f';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150, 205, 235, 0.8)';
  ctx.lineWidth = 1.7;
  ctx.stroke();

  // Side window strips along both cabin edges.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cabFwd - half * 0.05, s * (cabHalf - 1.6));
    ctx.lineTo(cabAft + half * 0.06, s * (cabHalf - 1.6));
    ctx.strokeStyle = 'rgba(20, 32, 44, 0.85)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = 'rgba(140, 195, 225, 0.75)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Roof skylight.
  ctx.fillStyle = 'rgba(120, 170, 200, 0.4)';
  ctx.strokeStyle = 'rgba(18, 30, 44, 0.6)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  roundedRect(ctx, (cabFwd + cabAft) / 2 - half * 0.05, -cabHalf * 0.3, half * 0.1, cabHalf * 0.6, 2);
  ctx.fill();
  ctx.stroke();

  // Radar arch + dome at the cabin aft end.
  ctx.strokeStyle = '#1a2836';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cabAft + 2, -cabHalf * 0.9);
  ctx.lineTo(cabAft + 2, cabHalf * 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cabAft + 2, 0, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#e8edf2';
  ctx.fill();
  ctx.strokeStyle = '#39434f';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Yacht-only flybridge with helm seat.
  if (isYacht) {
    ctx.beginPath();
    roundedRect(ctx, cabAft + half * 0.08, -cabHalf * 0.55, half * 0.26, cabHalf * 1.1, 4);
    ctx.fillStyle = 'rgba(228, 235, 242, 0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(18, 30, 44, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    drawEntitySeat(ctx, cabAft + half * 0.18, 0, cabHalf * 0.34);
  }

  // Bow rails with stanchions.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(half * 0.95, s * halfW * 0.12);
    ctx.quadraticCurveTo(half * 0.55, s * halfW * 0.72, cabFwd, s * halfW * 0.8);
    ctx.strokeStyle = 'rgba(235, 242, 248, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(235, 242, 248, 0.9)';
    for (const [px, py] of [
      [half * 0.85, halfW * 0.3],
      [half * 0.65, halfW * 0.58],
      [half * 0.45, halfW * 0.75],
    ]) {
      ctx.beginPath();
      ctx.arc(px, s * py, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Detailed sailboat: teak deck, coachroof, cockpit well, shrouds, then a
// shaded rig with sail shadows cast on the deck.
function drawSailboatTop(ctx, L, W, rig, accent) {
  const half = L / 2;
  const halfW = W / 2;
  const isDinghy = rig === 'dinghy';
  const mastX = isDinghy ? half * 0.45 : rig === 'ketch' ? half * 0.30 : half * 0.22;

  // Hull topsides.
  sailHullPath(ctx, half, halfW);
  const g = ctx.createLinearGradient(0, -halfW, 0, halfW);
  g.addColorStop(0, accent.top);
  g.addColorStop(0.5, accent.mid);
  g.addColorStop(1, accent.low);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(14, 22, 34, 0.9)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Teak deck inside the toe rail, with curved plank lines.
  ctx.save();
  sailHullPath(ctx, half - 2, halfW - 2);
  ctx.clip();
  const wg = ctx.createLinearGradient(0, -halfW, 0, halfW);
  wg.addColorStop(0, '#c9a26a');
  wg.addColorStop(0.5, '#b8915a');
  wg.addColorStop(1, '#9a7549');
  ctx.fillStyle = wg;
  ctx.fillRect(-half, -halfW, half * 2, halfW * 2);
  ctx.strokeStyle = 'rgba(60, 40, 18, 0.35)';
  ctx.lineWidth = 0.5;
  for (let i = -3; i <= 3; i++) {
    const py = (i / 3.5) * halfW;
    ctx.beginPath();
    ctx.moveTo(half * 0.95, py * 0.2);
    ctx.quadraticCurveTo(0, py * 1.05, -half * 0.97, py * 0.75);
    ctx.stroke();
  }
  ctx.restore();
  // Toe rail.
  sailHullPath(ctx, half - 2, halfW - 2);
  ctx.strokeStyle = 'rgba(50, 32, 14, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (isDinghy) {
    // Open cockpit with a wooden thwart.
    ctx.beginPath();
    roundedRect(ctx, -half * 0.7, -halfW * 0.55, half * 1.1, halfW * 1.1, 4);
    ctx.fillStyle = '#26405b';
    ctx.fill();
    ctx.strokeStyle = '#0d1f31';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#b8915a';
    ctx.strokeStyle = '#4a3318';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    roundedRect(ctx, -half * 0.15, -halfW * 0.55, 4.5, halfW * 1.1, 1.5);
    ctx.fill();
    ctx.stroke();
  } else {
    // Coachroof (cabin top) between mast and cockpit.
    const crFwd = mastX + half * 0.12;
    const crAft = -half * 0.3;
    ctx.beginPath();
    roundedRect(ctx, crAft, -halfW * 0.58, crFwd - crAft, halfW * 1.16, 5);
    const cg = ctx.createLinearGradient(0, -halfW * 0.58, 0, halfW * 0.58);
    cg.addColorStop(0, '#eef1f5');
    cg.addColorStop(0.5, '#f9fbfd');
    cg.addColorStop(1, '#ccd5e0');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 32, 48, 0.7)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // Side window strips.
    ctx.strokeStyle = 'rgba(30, 46, 60, 0.85)';
    ctx.lineWidth = 1.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(crFwd - 3, s * halfW * 0.46);
      ctx.lineTo(crAft + 4, s * halfW * 0.46);
      ctx.stroke();
    }
    // Skylight hatch.
    ctx.fillStyle = 'rgba(130, 180, 210, 0.5)';
    ctx.strokeStyle = 'rgba(20, 32, 48, 0.6)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    roundedRect(ctx, crFwd - half * 0.14, -halfW * 0.16, half * 0.1, halfW * 0.32, 1.5);
    ctx.fill();
    ctx.stroke();
    // Cockpit well near the stern.
    ctx.beginPath();
    roundedRect(ctx, -half * 0.78, -halfW * 0.42, half * 0.4, halfW * 0.84, 4);
    ctx.fillStyle = '#26405b';
    ctx.fill();
    ctx.strokeStyle = '#0d1f31';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Shrouds anchoring the mast to both gunwales.
  ctx.strokeStyle = 'rgba(200, 215, 228, 0.5)';
  ctx.lineWidth = 0.55;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(mastX, 0);
    ctx.lineTo(mastX - half * 0.05, s * (halfW - 3));
    ctx.stroke();
  }

  drawSailRig(ctx, half, halfW, rig);
}

// Sailing rig in body frame (+x = bow). Sails bulge to port as if caught on
// a light starboard-tack breeze. Each sail gets: a soft shadow cast on the
// deck, a luff→leech shading gradient, and radial panel seams — that's what
// lifts them off the "paper cutout" look.
function drawSailRig(ctx, half, halfW, rigType) {
  const sails = [];
  const masts = [];
  const booms = [];
  const stays = [];

  if (rigType === 'dinghy') {
    sails.push(makeSail(half * 0.45, -half * 0.55, halfW * 0.6));
    booms.push([half * 0.45, -half * 0.55]);
    masts.push([half * 0.45, 1.7]);
  } else if (rigType === 'ketch') {
    stays.push([half * 0.30, half * 0.93]);
    sails.push(makeSail(half * 0.30, half * 0.93, halfW * 0.42)); // jib
    sails.push(makeSail(half * 0.30, -half * 0.10, halfW * 0.7)); // main
    sails.push(makeSail(-half * 0.40, -half * 0.90, halfW * 0.55)); // mizzen
    booms.push([half * 0.30, -half * 0.10], [-half * 0.40, -half * 0.90]);
    masts.push([half * 0.30, 2.4], [-half * 0.40, 2.0]);
  } else {
    stays.push([half * 0.22, half * 0.92], [half * 0.22, -half * 0.92]);
    sails.push(makeSail(half * 0.22, half * 0.92, halfW * 0.48)); // jib
    sails.push(makeSail(half * 0.22, -half * 0.6, halfW * 0.72)); // main
    booms.push([half * 0.22, -half * 0.6]);
    masts.push([half * 0.22, 2.2]);
  }

  // Standing rigging.
  ctx.strokeStyle = 'rgba(180, 195, 210, 0.55)';
  ctx.lineWidth = 0.55;
  for (const [fromX, toX] of stays) {
    ctx.beginPath();
    ctx.moveTo(fromX, 0);
    ctx.lineTo(toX, 0);
    ctx.stroke();
  }

  // Sail shadows cast onto the deck.
  ctx.save();
  ctx.translate(2.2, 3.4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (const s of sails) {
    pathSail(ctx, s);
    ctx.fill();
  }
  ctx.restore();

  // Sails: gradient from bright luff to shaded leech, plus panel seams.
  for (const s of sails) {
    pathSail(ctx, s);
    const sg = ctx.createLinearGradient(s.ax, s.ay, s.bx, s.by);
    sg.addColorStop(0, 'rgba(255, 255, 254, 0.95)');
    sg.addColorStop(0.55, 'rgba(244, 247, 249, 0.93)');
    sg.addColorStop(1, 'rgba(206, 215, 222, 0.92)');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 50, 65, 0.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // Panel seams radiating from the clew.
    ctx.strokeStyle = 'rgba(70, 85, 100, 0.25)';
    ctx.lineWidth = 0.5;
    for (const t of [0.3, 0.55, 0.8]) {
      const qx = (1 - t) * (1 - t) * s.ax + 2 * (1 - t) * t * s.cx + t * t * s.bx;
      const qy = (1 - t) * (1 - t) * s.ay + 2 * (1 - t) * t * s.cy + t * t * s.by;
      ctx.beginPath();
      ctx.moveTo(s.bx, s.by);
      ctx.lineTo(qx, qy);
      ctx.stroke();
    }
  }

  // Booms along the sail feet.
  ctx.strokeStyle = '#3d3322';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const [fromX, toX] of booms) {
    ctx.beginPath();
    ctx.moveTo(fromX, 0);
    ctx.lineTo(toX, 0);
    ctx.stroke();
  }

  // Masts — brushed aluminum discs.
  for (const [x, r] of masts) {
    const mg = ctx.createRadialGradient(x - r * 0.4, -r * 0.4, 0.3, x, 0, r);
    mg.addColorStop(0, '#eef1f4');
    mg.addColorStop(0.6, '#9aa4ae');
    mg.addColorStop(1, '#5a636d');
    ctx.beginPath();
    ctx.arc(x, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.8)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

// Sail geometry: anchor a = (ax, 0) at the mast/tack, b = (bx, 0) at the
// clew/head, with a quadratic control point. All sails bulge to port
// (−y) so the whole rig reads as set on the same tack.
function makeSail(ax, bx, bulge) {
  return {
    ax, ay: 0, bx, by: 0,
    cx: (ax + bx) / 2,
    cy: -bulge,
  };
}

function pathSail(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s.ax, s.ay);
  ctx.quadraticCurveTo(s.cx, s.cy, s.bx, s.by);
  ctx.closePath();
}

function drawCatamaranTop(ctx, L, W, accent) {
  const half = L / 2;
  const halfW = W / 2;
  const hullHalfW = Math.max(5, halfW * 0.17);
  const off = halfW - hullHalfW;

  // Crossbeams connecting the hulls (under the deck structures).
  ctx.fillStyle = '#28323f';
  ctx.fillRect(-half * 0.62, -off, half * 0.1, off * 2);
  ctx.fillRect(half * 0.5, -off, half * 0.08, off * 2);

  // Twin hulls with gradient + gloss.
  for (const sign of [-1, 1]) {
    const c = sign * off;
    catHullPath(ctx, half, hullHalfW, c);
    const g = ctx.createLinearGradient(0, c - hullHalfW, 0, c + hullHalfW);
    g.addColorStop(0, accent.top);
    g.addColorStop(0.5, accent.mid);
    g.addColorStop(1, accent.low);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(14, 22, 34, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    catHullPath(ctx, half, hullHalfW, c);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(half * 0.85, c - hullHalfW * 0.2);
    ctx.quadraticCurveTo(0, c - hullHalfW * 0.65, -half * 0.8, c - hullHalfW * 0.35);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Forward trampoline — taut mesh netting between the bows.
  const trampFwd = half * 0.82;
  const trampAft = half * 0.16;
  const trampHalf = off - hullHalfW * 0.4;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(trampFwd, -trampHalf * 0.35);
  ctx.lineTo(trampAft, -trampHalf);
  ctx.lineTo(trampAft, trampHalf);
  ctx.lineTo(trampFwd, trampHalf * 0.35);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8, 14, 22, 0.5)';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(190, 205, 218, 0.28)';
  ctx.lineWidth = 0.5;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(trampAft, (i / 6) * trampHalf);
    ctx.lineTo(trampFwd, (i / 6) * trampHalf * 0.35);
    ctx.stroke();
  }
  for (let k = 0; k <= 6; k++) {
    const x = trampAft + ((trampFwd - trampAft) * k) / 6;
    const sc = 1 - (0.65 * (x - trampAft)) / (trampFwd - trampAft);
    ctx.beginPath();
    ctx.moveTo(x, -trampHalf * sc);
    ctx.lineTo(x, trampHalf * sc);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(trampFwd, -trampHalf * 0.35);
  ctx.lineTo(trampAft, -trampHalf);
  ctx.lineTo(trampAft, trampHalf);
  ctx.lineTo(trampFwd, trampHalf * 0.35);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(20, 30, 42, 0.8)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Bridge deck spanning the hulls aft of the trampoline.
  ctx.beginPath();
  roundedRect(ctx, -half * 0.78, -(off - hullHalfW * 0.25), half * 0.94, (off - hullHalfW * 0.25) * 2, 5);
  const bg = ctx.createLinearGradient(0, -off, 0, off);
  bg.addColorStop(0, '#dfe6ee');
  bg.addColorStop(0.5, '#f2f6fa');
  bg.addColorStop(1, '#c3cdd9');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 30, 44, 0.75)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Cabin pod with a wrap-around front window.
  const cabFwd = half * 0.05;
  const cabAft = -half * 0.5;
  const cabHalf = off * 0.62;
  ctx.beginPath();
  roundedRect(ctx, cabAft, -cabHalf, cabFwd - cabAft, cabHalf * 2, 6);
  const cg = ctx.createLinearGradient(0, -cabHalf, 0, cabHalf);
  cg.addColorStop(0, '#eef1f5');
  cg.addColorStop(0.5, '#f9fbfd');
  cg.addColorStop(1, '#c7d1dd');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 30, 44, 0.8)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Wrap window band at the cabin front.
  ctx.beginPath();
  ctx.moveTo(cabFwd - 2, -cabHalf * 0.75);
  ctx.quadraticCurveTo(cabFwd + half * 0.07, 0, cabFwd - 2, cabHalf * 0.75);
  ctx.strokeStyle = '#16242f';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150, 205, 235, 0.8)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Side window strips.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cabFwd - half * 0.04, s * (cabHalf - 1.5));
    ctx.lineTo(cabAft + half * 0.05, s * (cabHalf - 1.5));
    ctx.strokeStyle = 'rgba(20, 32, 44, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Aft helm seat on the bridge deck.
  drawEntitySeat(ctx, -half * 0.64, 0, Math.max(6, off * 0.36));
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

  // Bow/front direction marker so the current heading is readable. Rotation
  // is keyboard-driven ([ / ], Shift for 45° snap), so no on-canvas handle.
  ctx.fillStyle = 'rgba(255, 220, 90, 0.95)';
  ctx.beginPath();
  ctx.moveTo(L / 2 + 11, 0);
  ctx.lineTo(L / 2 + 3, -5);
  ctx.lineTo(L / 2 + 3, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- Placement ghost ----------

// Translucent preview of the entity about to be placed, anchored to the
// mouse. Reuses the real entity art (minus the drop shadow) at low alpha,
// plus a dashed cyan footprint so it clearly reads as "not placed yet".
function drawPlacementGhost(ctx, w, h, world) {
  const hover = world.edit.hover;
  const tool = world.edit.tool;
  if (!hover || tool === 'select' || world.edit.dragging) return;
  const p = presetById(tool);
  if (!p) return;
  // Over an existing entity a click selects instead of placing — no ghost.
  if (findEntityAt(hover.x, hover.y, world.entities)) return;

  const ghost = {
    id: '__ghost__',
    presetId: p.id,
    category: p.category,
    x: hover.x,
    y: hover.y,
    heading: 0,
    length: p.length,
    width: p.width,
    hull: p.hull,
    sail: p.sail,
    cabin: p.cabin,
    beacon: p.beacon,
  };
  // Show exactly where a dock will land after magnetic snapping.
  let snapped = false;
  if (p.category === 'dock') {
    const snap = snapDockPose(ghost, world.entities);
    if (snap) {
      ghost.x = snap.x;
      ghost.y = snap.y;
      ghost.heading = snap.heading;
      snapped = true;
    }
  }

  const L = p.length * PX_PER_M;
  const W = p.width * PX_PER_M;
  const sx = w / 2 + (ghost.x - world.camera.x) * PX_PER_M;
  const sy = h / 2 + (ghost.y - world.camera.y) * PX_PER_M;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ghost.heading);
  ctx.globalAlpha = 0.45;
  if (p.category === 'dock') {
    drawDockEntity(ctx, ghost);
  } else if (p.category === 'bollard') {
    drawBollardEntity(ctx, ghost);
  } else if (p.category === 'buoy') {
    drawBuoyEntity(ctx, ghost, 0);
  } else if (p.hull === 'cat') {
    drawCatamaranTop(ctx, L, W, pickAccent(ghost));
  } else if (p.sail) {
    drawSailboatTop(ctx, L, W, p.sail === true ? 'sloop' : p.sail, pickAccent(ghost));
  } else {
    drawMotorboatTop(ctx, L, W, ghost, pickAccent(ghost));
  }
  // Dashed footprint marker — turns green when snapped to a neighbour.
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = snapped ? 'rgba(120, 240, 150, 0.98)' : 'rgba(130, 220, 255, 0.95)';
  ctx.lineWidth = snapped ? 2 : 1.4;
  ctx.strokeRect(-L / 2 - 3, -W / 2 - 3, L + 6, W + 6);
  ctx.setLineDash([]);
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
    'Click             Select / place on open water',
    'Drag              Move selected (docks snap end-to-end)',
    '[  ]  or  Wheel    Rotate selected (5°)',
    'Shift + [ ] / Wheel  Rotate snap to 45°',
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

  // Two-pass soft shadow underneath the hull — a wide faint pass plus a
  // tighter darker one approximates a blurred drop shadow cheaply.
  ctx.save();
  ctx.translate(2.5, 4);
  hullOutlinePath(ctx, half * 1.06, halfW * 1.2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
  ctx.fill();
  hullOutlinePath(ctx, half * 1.01, halfW * 1.05);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fill();
  ctx.restore();

  // 1) Rudder — transom-hung blade, drawn BEFORE the hull so the stock and
  //    mounting hardware tuck under the transom edge. (The engine is the
  //    inboard compartment inside the cockpit; this is the steering foil.)
  drawRudder(ctx, half, boat.rudder);

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
  // Gloss highlight sweeping along the port sheer line — gives the
  // fiberglass a curved, light-catching look.
  ctx.beginPath();
  ctx.moveTo(half * 0.8, -halfW * 0.25);
  ctx.quadraticCurveTo(0, -halfW * 0.78, -half * 0.85, -halfW * 0.5);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
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

  // 14) Cleats (mooring fittings) at the gunwale corners + midship sides.
  drawCleat(ctx, half * 0.45,  halfW * 0.84);
  drawCleat(ctx, half * 0.45, -halfW * 0.84);
  drawCleat(ctx, 0,  halfW * 0.84);
  drawCleat(ctx, 0, -halfW * 0.84);
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

function drawRudder(ctx, half, rudderActual) {
  // Transom-hung rudder. The whole assembly pivots about the rudder stock
  // with the actual (smoothed) rudder value — same source as the physics.
  // Top-down view: a symmetric hydrofoil blade trailing aft of the stock,
  // widest near the leading edge and tapering to the trailing edge.

  // Mounting hardware drawn UN-rotated: gudgeon plate bolted to the transom.
  ctx.save();
  ctx.translate(-half, 0);

  ctx.fillStyle = '#39434f';
  ctx.strokeStyle = '#10151c';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  roundedRect(ctx, -1.5, -4.5, 4, 9, 1.2);
  ctx.fill();
  ctx.stroke();
  // Bolt heads on the plate.
  ctx.fillStyle = '#9aa6b4';
  for (const by of [-3, 3]) {
    ctx.beginPath();
    ctx.arc(0.5, by, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rotating assembly: stock + blade + tiller link.
  ctx.save();
  ctx.translate(-2, 0); // stock sits just aft of the transom
  ctx.rotate(rudderActual * 0.6); // visual deflection up to ~35°

  const chord = 26;  // blade length aft of the stock (px ≈ 1.3 m)
  const thick = 8;   // max foil thickness

  // Submerged shadow of the blade (offset, soft) — reads as underwater depth.
  ctx.save();
  ctx.translate(1.5, 2.2);
  ctx.globalAlpha = 0.25;
  rudderFoilPath(ctx, chord, thick);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // Blade — slightly translucent dark foil so it reads as below the surface.
  rudderFoilPath(ctx, chord, thick);
  const bladeGrad = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
  bladeGrad.addColorStop(0, 'rgba(52, 66, 82, 0.92)');
  bladeGrad.addColorStop(0.5, 'rgba(30, 40, 52, 0.92)');
  bladeGrad.addColorStop(1, 'rgba(16, 22, 30, 0.92)');
  ctx.fillStyle = bladeGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(8, 12, 18, 0.9)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Centerline crease of the foil (catching a bit of light).
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-chord + 3, 0);
  ctx.strokeStyle = 'rgba(160, 185, 205, 0.35)';
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // Rudder stock — stainless pivot post.
  const stockGrad = ctx.createRadialGradient(-0.8, -0.8, 0.3, 0, 0, 3);
  stockGrad.addColorStop(0, '#e8edf2');
  stockGrad.addColorStop(0.6, '#9aa6b4');
  stockGrad.addColorStop(1, '#454f5c');
  ctx.beginPath();
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = stockGrad;
  ctx.fill();
  ctx.strokeStyle = '#10151c';
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // Tiller link arm reaching forward through the transom (steering linkage).
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(6.5, 0);
  ctx.strokeStyle = '#222b36';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(6.5, 0, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = '#9aa6b4';
  ctx.fill();

  ctx.restore(); // rotating assembly
  ctx.restore(); // transom frame
}

// Symmetric hydrofoil outline: rounded leading edge at the stock, max
// thickness ~30% chord, tapering to a narrow squared-off trailing edge.
function rudderFoilPath(ctx, chord, thick) {
  const t2 = thick / 2;
  ctx.beginPath();
  ctx.moveTo(2.2, 0); // leading edge (just ahead of the stock)
  ctx.bezierCurveTo(2.2, -t2 * 0.85, -chord * 0.30, -t2, -chord * 0.45, -t2 * 0.8);
  ctx.bezierCurveTo(-chord * 0.72, -t2 * 0.5, -chord * 0.92, -t2 * 0.2, -chord, -0.6);
  ctx.lineTo(-chord, 0.6); // blunt trailing edge
  ctx.bezierCurveTo(-chord * 0.92, t2 * 0.2, -chord * 0.72, t2 * 0.5, -chord * 0.45, t2 * 0.8);
  ctx.bezierCurveTo(-chord * 0.30, t2, 2.2, t2 * 0.85, 2.2, 0);
  ctx.closePath();
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

// ---------- Thruster rockers (bow / stern) ----------

function drawThrusterPanel(ctx, w, h, boat, time) {
  const layout = thrusterLayout(w, h);
  const { px, py, panelW, panelH } = layout;

  ctx.save();

  // Housing (matches the throttle panel styling).
  roundedRect(ctx, px, py, panelW, panelH, 12);
  const housingGrad = ctx.createLinearGradient(px, py, px, py + panelH);
  housingGrad.addColorStop(0, 'rgba(20, 40, 56, 0.78)');
  housingGrad.addColorStop(1, 'rgba(6, 18, 28, 0.78)');
  ctx.fillStyle = housingGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 235, 250, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(220, 240, 250, 0.75)';
  ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THRUSTERS', px + panelW / 2, py + 18);

  drawThrusterRocker(ctx, layout.bow, 'BOW', 'Q', 'E', boat.bowThruster, boat.bowHeat, boat.bowLocked, boat.bowTrip, time);
  drawThrusterRocker(ctx, layout.stern, 'STERN', 'Z', 'C', boat.sternThruster, boat.sternHeat, boat.sternLocked, boat.sternTrip, time);

  ctx.restore();
}

// One momentary rocker: ◀ port half / starboard half ▶. The active side
// glows with intensity proportional to the spooled thruster value. Below it
// sits a heat gauge; when the unit overheats the rocker dims, goes red, and
// shows OVERHEAT until it has cooled.
function drawThrusterRocker(ctx, r, label, keyPort, keyStbd, value, heat, locked, trip, time) {
  // Label above the rocker.
  ctx.fillStyle = 'rgba(180, 210, 230, 0.7)';
  ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, r.x + r.w / 2, r.y - 5);

  // Body.
  roundedRect(ctx, r.x, r.y, r.w, r.h, 7);
  ctx.fillStyle = 'rgba(8, 18, 26, 0.95)';
  ctx.fill();
  ctx.strokeStyle = locked ? 'rgba(255, 110, 90, 0.7)' : 'rgba(200, 235, 250, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (locked) {
    // Locked-out: red wash + blinking OVERHEAT caption, no active glow.
    ctx.save();
    roundedRect(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.clip();
    const blink = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(time * 6));
    ctx.fillStyle = `rgba(220, 70, 50, ${blink.toFixed(3)})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 180, 160, 0.95)';
    ctx.font = 'bold 9px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OVERHEAT', r.x + r.w / 2, r.y + r.h / 2 + 3);
  } else {
    // Active-side glow (port = value < 0, starboard = value > 0).
    const mag = Math.min(1, Math.abs(value));
    if (mag > 0.03) {
      ctx.save();
      roundedRect(ctx, r.x, r.y, r.w, r.h, 7);
      ctx.clip();
      const half = r.w / 2;
      const gx = value < 0 ? r.x : r.x + half;
      const grad = ctx.createLinearGradient(r.x + half, 0, value < 0 ? r.x : r.x + r.w, 0);
      grad.addColorStop(0, 'rgba(80, 200, 255, 0)');
      grad.addColorStop(1, `rgba(80, 200, 255, ${(0.55 * mag).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(gx, r.y, half, r.h);
      ctx.restore();
    }

    // Center divider notch.
    ctx.strokeStyle = 'rgba(200, 235, 250, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + r.w / 2, r.y + 4);
    ctx.lineTo(r.x + r.w / 2, r.y + r.h - 4);
    ctx.stroke();

    // Arrows + key captions on each half.
    const cy = r.y + r.h / 2;
    ctx.fillStyle = 'rgba(225, 240, 250, 0.9)';
    ctx.font = 'bold 12px -apple-system, sans-serif';
    ctx.fillText('◀', r.x + r.w * 0.25, cy + 1);
    ctx.fillText('▶', r.x + r.w * 0.75, cy + 1);
    ctx.fillStyle = 'rgba(170, 195, 215, 0.6)';
    ctx.font = '8px monospace';
    ctx.fillText(keyPort, r.x + r.w * 0.25, r.y + r.h - 4);
    ctx.fillText(keyStbd, r.x + r.w * 0.75, r.y + r.h - 4);
  }

  // Heat gauge directly below the rocker.
  const gy = r.y + r.h + 3;
  const gh = 4;
  roundedRect(ctx, r.x, gy, r.w, gh, 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  const hv = Math.max(0, Math.min(1, heat));
  const tv = Math.max(0.05, Math.min(1, trip));
  if (hv > 0.001) {
    // Colour by how close heat is to the (shrinking) trip point.
    const ratio = hv / tv;
    let col;
    if (ratio < 0.5) col = '90, 210, 120';
    else if (ratio < 0.8) col = '230, 200, 70';
    else col = '230, 80, 60';
    ctx.save();
    roundedRect(ctx, r.x, gy, r.w, gh, 2);
    ctx.clip();
    ctx.fillStyle = `rgba(${col}, 0.95)`;
    ctx.fillRect(r.x, gy, r.w * hv, gh);
    ctx.restore();
  }
  // Beyond the trip point: dim the gauge to show lost (fatigued) capacity.
  if (tv < 0.999) {
    ctx.fillStyle = 'rgba(120, 30, 24, 0.5)';
    ctx.fillRect(r.x + r.w * tv, gy, r.w * (1 - tv), gh);
  }
  // Moving red-line tick at the current trip point.
  ctx.strokeStyle = 'rgba(255, 120, 100, 0.95)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(r.x + r.w * tv, gy - 1.5);
  ctx.lineTo(r.x + r.w * tv, gy + gh + 1.5);
  ctx.stroke();
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
    'Q / E    Bow thruster   (hold — momentary)',
    'Z / C    Stern thruster (hold — momentary)',
    'Space    Snap throttle & helm to neutral',
    'Mouse    Drag throttle lever / helm wheel,',
    '         hold thruster rockers',
    'M        Map editor',
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
