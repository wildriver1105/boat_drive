// Pre-rendered graphical assets for the renderer. Everything here is
// generated ONCE at startup into offscreen canvases — the per-frame cost
// is just pattern fills and drawImage calls, which Canvas 2D handles at
// 60fps easily. This is what lets the water/foam look rich without a
// WebGL shader.
//
// Client-only: uses document.createElement('canvas'). The renderer is only
// constructed inside a 'use client' effect, so this never runs during SSR.

const TILE_SIZE = 256;

export function createFx() {
  return {
    tileSize: TILE_SIZE,
    // Three scales of value-noise stand in for a layered water surface:
    //   A — fine, high-contrast ripples
    //   B — medium chop
    //   C — large, soft ocean swell (the slow rolling undulation)
    noiseA: makeWaterTile(TILE_SIZE, 70, 1234, { rMin: 8, rMax: 22, aMin: 0.05, aMax: 0.14 }),
    noiseB: makeWaterTile(TILE_SIZE, 40, 56789, { rMin: 16, rMax: 40, aMin: 0.04, aMax: 0.1 }),
    noiseC: makeWaterTile(TILE_SIZE, 16, 99173, { rMin: 48, rMax: 96, aMin: 0.05, aMax: 0.1, light: 0.55 }),
    foam: makeFoamSprite(64),
    // Patterns are created lazily by the renderer (needs its ctx).
    patA: null,
    patB: null,
    patC: null,
    // Vignette overlay cache, rebuilt when the canvas size changes.
    vignette: null,
    vignetteW: 0,
    vignetteH: 0,
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Deterministic LCG so the tiles look the same every load.
function makeRng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0xffff) / 0x10000;
  };
}

// Tileable soft-blob value noise. Each blob is also drawn at ±size offsets
// so the pattern wraps seamlessly. Mix of light and dark blobs gives the
// water surface both highlights and depth shadows. opts tunes blob size,
// opacity, and the light/dark ratio for different scales of detail.
function makeWaterTile(size, blobCount, seed, opts = {}) {
  const { rMin = 10, rMax = 40, aMin = 0.05, aMax = 0.16, light = 0.6 } = opts;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const rnd = makeRng(seed);
  for (let i = 0; i < blobCount; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = rMin + rnd() * (rMax - rMin);
    const a = aMin + rnd() * (aMax - aMin);
    const isLight = rnd() < light;
    const col = isLight ? '225, 245, 255' : '3, 18, 34';
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, `rgba(${col}, ${a.toFixed(3)})`);
        grad.addColorStop(1, `rgba(${col}, 0)`);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  return c;
}

// Textured white foam blob: bright radial core punched with darker holes so
// it reads as churned water rather than a flat white circle.
function makeFoamSprite(size) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const cx = size / 2;
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  core.addColorStop(0.45, 'rgba(245, 252, 255, 0.5)');
  core.addColorStop(1, 'rgba(245, 252, 255, 0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);

  // Punch speckle holes for turbulence texture.
  g.globalCompositeOperation = 'destination-out';
  const rnd = makeRng(424242);
  for (let i = 0; i < 16; i++) {
    const x = cx + (rnd() - 0.5) * size * 0.85;
    const y = cx + (rnd() - 0.5) * size * 0.85;
    const r = 2 + rnd() * 7;
    const hole = g.createRadialGradient(x, y, 0, x, y, r);
    hole.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = hole;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

// Full-screen vignette + warm sun glare, cached per canvas size. Gives the
// scene depth and a "broadcast camera" look for almost zero per-frame cost.
export function getVignette(fx, w, h) {
  const cw = Math.max(2, Math.round(w));
  const ch = Math.max(2, Math.round(h));
  if (fx.vignette && fx.vignetteW === cw && fx.vignetteH === ch) return fx.vignette;

  const c = makeCanvas(cw, ch);
  const g = c.getContext('2d');

  const edge = g.createRadialGradient(
    cw / 2, ch / 2, Math.min(cw, ch) * 0.42,
    cw / 2, ch / 2, Math.hypot(cw, ch) * 0.6
  );
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(2, 12, 22, 0.45)');
  g.fillStyle = edge;
  g.fillRect(0, 0, cw, ch);

  // Warm sun glare from the upper right.
  const sun = g.createRadialGradient(
    cw * 0.74, ch * 0.16, 0,
    cw * 0.74, ch * 0.16, Math.max(cw, ch) * 0.55
  );
  sun.addColorStop(0, 'rgba(255, 241, 196, 0.10)');
  sun.addColorStop(1, 'rgba(255, 241, 196, 0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, cw, ch);

  fx.vignette = c;
  fx.vignetteW = cw;
  fx.vignetteH = ch;
  return c;
}
