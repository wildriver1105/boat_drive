// Rigid-body collision handling between the player boat and the map
// entities, and between entities themselves.
//
//   • Detection:  SAT (separating-axis test) between oriented rectangles,
//                 returning the minimum translation vector (MTV).
//   • Response:   impulse at an approximated contact point — affects both
//                 linear and angular velocity, so glancing hits spin the
//                 hull believably. Plus Coulomb-style friction along the
//                 contact tangent and positional de-penetration.
//   • Masses:     player boat uses MASS / I_Z from constants. Parked boats
//                 get mass from footprint area (ENTITY_DENSITY). Docks are
//                 STATIC — invMass = invI = 0, they never move.
//
// Everything works in world meters on objects that expose
// { x, y, heading, vx, vy, omega } — the player boat already does, and
// parked boats get transient velocity fields lazily (not persisted).

import {
  MASS,
  I_Z,
  BOAT_LENGTH,
  BOAT_WIDTH,
  ENTITY_DENSITY,
  COLLISION_RESTITUTION,
  COLLISION_FRICTION,
  COLLISION_CORRECTION,
  ENTITY_LIN_DAMP,
  ENTITY_ANG_DAMP,
} from './constants.js';

const SOLVER_ITERATIONS = 2;
// Impulse above which we splash some foam at the contact point.
const SPLASH_IMPULSE = 900;
// Numerical safety rails: deep overlaps (e.g. a boat placed inside a dock in
// the editor) are resolved over several steps instead of one explosive shove,
// and impulses are capped so no contact can fling a hull at escape velocity.
const MAX_DEPTH_PER_STEP = 1.5;  // m
const MAX_IMPULSE = 100000;       // N·s

function ensureDyn(e) {
  if (e.vx === undefined) {
    e.vx = 0;
    e.vy = 0;
    e.omega = 0;
  }
}

// Integrate parked-boat motion (they only move because something pushed
// them). Water drag bleeds the motion away; tiny residuals snap to zero so
// idle boats cost nothing. Returns true if anything actually moved.
export function stepEntities(world, dt) {
  let moved = false;
  const linDamp = Math.exp(-ENTITY_LIN_DAMP * dt);
  const angDamp = Math.exp(-ENTITY_ANG_DAMP * dt);
  for (const e of world.entities) {
    if (e.category !== 'boat') continue; // docks & buoys never move
    if (e.vx === undefined) continue;
    if (e.vx === 0 && e.vy === 0 && e.omega === 0) continue;

    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.heading += e.omega * dt;
    if (e.heading > Math.PI) e.heading -= 2 * Math.PI;
    else if (e.heading <= -Math.PI) e.heading += 2 * Math.PI;

    e.vx *= linDamp;
    e.vy *= linDamp;
    e.omega *= angDamp;
    if (Math.hypot(e.vx, e.vy) < 0.02 && Math.abs(e.omega) < 0.01) {
      e.vx = 0;
      e.vy = 0;
      e.omega = 0;
    }
    moved = true;
  }
  return moved;
}

// Build the body list: player + all entities, with inverse mass/inertia.
function collectBodies(world) {
  const ms = world.boat.massScale > 0 ? world.boat.massScale : 1;
  const bodies = [
    {
      obj: world.boat,
      L: BOAT_LENGTH,
      W: BOAT_WIDTH,
      invM: 1 / (MASS * ms),
      invI: 1 / (I_Z * ms),
      isStatic: false,
      isEntity: false,
    },
  ];
  for (const e of world.entities) {
    // Skip anything with a corrupted pose or degenerate footprint — a bad
    // body would poison every contact it participates in.
    if (
      !Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.heading) ||
      !Number.isFinite(e.length) || e.length <= 0 ||
      !Number.isFinite(e.width) || e.width <= 0
    ) continue;
    // Vertex-edited terrain: the polygon may be CONCAVE, which plain SAT
    // can't resolve. Collide against the COASTLINE instead — one thin static
    // OBB per polygon edge. Bays and headlands then behave correctly.
    if (e.category === 'terrain' && Array.isArray(e.poly) && e.poly.length >= 3) {
      const cosH = Math.cos(e.heading);
      const sinH = Math.sin(e.heading);
      const n = e.poly.length;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = e.poly[i];
        const [bx, by] = e.poly[(i + 1) % n];
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const wx = e.x + mx * cosH - my * sinH;
        const wy = e.y + mx * sinH + my * cosH;
        const edgeLen = Math.hypot(bx - ax, by - ay);
        if (edgeLen < 0.05) continue;
        const edgeHeading = e.heading + Math.atan2(by - ay, bx - ax);
        bodies.push({
          obj: { x: wx, y: wy, heading: edgeHeading, vx: 0, vy: 0, omega: 0 },
          L: edgeLen,
          W: 0.9,
          invM: 0,
          invI: 0,
          isStatic: true,
          isEntity: false,
        });
      }
      continue;
    }
    // Docks AND buoys are static — anchored, infinite mass, never pushed.
    const isStatic = e.category !== 'boat';
    if (!isStatic) {
      ensureDyn(e);
      if (!Number.isFinite(e.vx + e.vy + e.omega)) {
        e.vx = 0;
        e.vy = 0;
        e.omega = 0;
      }
    }
    const m = ENTITY_DENSITY * e.length * e.width;
    const I = (m * (e.length * e.length + e.width * e.width)) / 12;
    bodies.push({
      obj: e,
      L: e.length,
      W: e.width,
      invM: isStatic ? 0 : 1 / m,
      invI: isStatic ? 0 : 1 / I,
      isStatic,
      isEntity: !isStatic,
    });
  }
  return bodies;
}

// Resolve all contacts. Returns true if any entity was moved by a collision
// (used by the loop to schedule a map autosave).
export function resolveCollisions(world) {
  const bodies = collectBodies(world);
  let entityTouched = false;

  for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.isStatic && b.isStatic) continue; // static pair — nothing to do

        // Broadphase: bounding circles.
        const ra = 0.5 * Math.hypot(a.L, a.W);
        const rb = 0.5 * Math.hypot(b.L, b.W);
        const dx = b.obj.x - a.obj.x;
        const dy = b.obj.y - a.obj.y;
        if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) continue;

        if (resolvePair(world, a, b)) {
          if (a.isEntity || b.isEntity) entityTouched = true;
        }
      }
    }
  }
  return entityTouched;
}

function resolvePair(world, a, b) {
  const A = a.obj;
  const B = b.obj;
  const cornersA = obbCorners(A.x, A.y, A.heading, a.L, a.W);
  const cornersB = obbCorners(B.x, B.y, B.heading, b.L, b.W);
  const mtv = obbMTV(A, B, cornersA, cornersB);
  if (!mtv) return false;

  const nx = mtv.nx;
  const ny = mtv.ny;
  const totalInv = a.invM + b.invM;
  if (totalInv === 0 || !Number.isFinite(totalInv)) return false;

  // Positional correction — push the dynamic side(s) out of penetration,
  // split by inverse mass (a dock takes none, so the boat does all of it).
  // Depth is capped so deep editor-made overlaps unwind over a few steps
  // instead of one teleporting shove.
  const depth = Math.min(mtv.depth, MAX_DEPTH_PER_STEP);
  const corr = (depth * COLLISION_CORRECTION) / totalInv;
  A.x -= nx * corr * a.invM;
  A.y -= ny * corr * a.invM;
  B.x += nx * corr * b.invM;
  B.y += ny * corr * b.invM;

  // Contact point ≈ mean of mutually-contained corners.
  const p = contactPoint(A, B, a, b, cornersA, cornersB);
  const rAx = p.x - A.x;
  const rAy = p.y - A.y;
  const rBx = p.x - B.x;
  const rBy = p.y - B.y;

  // Velocity of each body at the contact point: v + ω×r.
  const velAx = A.vx - A.omega * rAy;
  const velAy = A.vy + A.omega * rAx;
  const velBx = B.vx - B.omega * rBy;
  const velBy = B.vy + B.omega * rBx;
  const rvx = velBx - velAx;
  const rvy = velBy - velAy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return true; // already separating — de-penetration was enough

  // Normal impulse (clamped — a contact can stop a hull, not launch it).
  const rAn = rAx * ny - rAy * nx;
  const rBn = rBx * ny - rBy * nx;
  const denom = totalInv + rAn * rAn * a.invI + rBn * rBn * b.invI;
  let jn = (-(1 + COLLISION_RESTITUTION) * vn) / denom;
  if (!Number.isFinite(jn)) return true;
  if (jn > MAX_IMPULSE) jn = MAX_IMPULSE;
  applyImpulse(A, a, B, b, jn * nx, jn * ny, rAx, rAy, rBx, rBy);

  // Friction impulse along the contact tangent, clamped by Coulomb cone.
  let tx = rvx - vn * nx;
  let ty = rvy - vn * ny;
  const tl = Math.hypot(tx, ty);
  if (tl > 1e-6) {
    tx /= tl;
    ty /= tl;
    const rAt = rAx * ty - rAy * tx;
    const rBt = rBx * ty - rBy * tx;
    const denomT = totalInv + rAt * rAt * a.invI + rBt * rBt * b.invI;
    let jt = -(rvx * tx + rvy * ty) / denomT;
    if (Number.isFinite(jt)) {
      const maxF = Math.abs(jn) * COLLISION_FRICTION;
      if (jt > maxF) jt = maxF;
      else if (jt < -maxF) jt = -maxF;
      applyImpulse(A, a, B, b, jt * tx, jt * ty, rAx, rAy, rBx, rBy);
    }
  }

  // Foam splash on solid hits — visual/feel feedback for the contact.
  if (Math.abs(jn) > SPLASH_IMPULSE) {
    const count = Math.min(4, 1 + Math.floor(Math.abs(jn) / 1500));
    for (let k = 0; k < count; k++) {
      world.wake.push({
        x: p.x + (Math.random() - 0.5) * 0.8,
        y: p.y + (Math.random() - 0.5) * 0.8,
        vx: nx * (Math.random() - 0.5) * 2,
        vy: ny * (Math.random() - 0.5) * 2,
        born: world.time,
        lifetime: 0.6 + Math.random() * 0.5,
        size0: 0.4,
        grow: 1.8,
        alpha: 0.5,
      });
    }
  }
  return true;
}

// Last line of defense: if any dynamic state ever turns non-finite (a
// degenerate contact, a corrupted save, a stale build), restore the last
// healthy pose and kill the motion instead of freezing the whole game on a
// NaN camera. Snapshots are taken every healthy step.
export function guardDynamics(world) {
  const b = world.boat;
  if (!Number.isFinite(b.x + b.y + b.heading + b.vx + b.vy + b.omega)) {
    b.x = Number.isFinite(b._gx) ? b._gx : 0;
    b.y = Number.isFinite(b._gy) ? b._gy : 0;
    b.heading = Number.isFinite(b._gh) ? b._gh : 0;
    b.vx = 0;
    b.vy = 0;
    b.omega = 0;
  } else {
    b._gx = b.x;
    b._gy = b.y;
    b._gh = b.heading;
  }

  for (const e of world.entities) {
    if (e.category !== 'boat') continue; // statics have no dynamics to guard
    if (e.vx !== undefined && !Number.isFinite(e.vx + e.vy + e.omega)) {
      e.vx = 0;
      e.vy = 0;
      e.omega = 0;
    }
    if (!Number.isFinite(e.x + e.y + e.heading)) {
      e.x = Number.isFinite(e._gx) ? e._gx : world.camera.x + 10;
      e.y = Number.isFinite(e._gy) ? e._gy : world.camera.y;
      e.heading = Number.isFinite(e._gh) ? e._gh : 0;
    } else {
      e._gx = e.x;
      e._gy = e.y;
      e._gh = e.heading;
    }
  }
}

function applyImpulse(A, a, B, b, jx, jy, rAx, rAy, rBx, rBy) {
  A.vx -= jx * a.invM;
  A.vy -= jy * a.invM;
  A.omega -= (rAx * jy - rAy * jx) * a.invI;
  B.vx += jx * b.invM;
  B.vy += jy * b.invM;
  B.omega += (rBx * jy - rBy * jx) * b.invI;
}

// ---------- Oriented-box geometry ----------

function obbCorners(cx, cy, heading, L, W) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const hx = L / 2;
  const hy = W / 2;
  return [
    { x: cx + c * hx - s * hy, y: cy + s * hx + c * hy },
    { x: cx + c * hx + s * hy, y: cy + s * hx - c * hy },
    { x: cx - c * hx + s * hy, y: cy - s * hx - c * hy },
    { x: cx - c * hx - s * hy, y: cy - s * hx + c * hy },
  ];
}

function project(corners, ax) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const d = p.x * ax.x + p.y * ax.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// SAT over the 4 face normals of the two boxes. Returns the minimum
// translation vector ({nx, ny, depth}, normal pointing A → B) or null when
// the boxes don't overlap.
function obbMTV(A, B, cornersA, cornersB) {
  const ca = Math.cos(A.heading);
  const sa = Math.sin(A.heading);
  const cb = Math.cos(B.heading);
  const sb = Math.sin(B.heading);
  const axes = [
    { x: ca, y: sa },
    { x: -sa, y: ca },
    { x: cb, y: sb },
    { x: -sb, y: cb },
  ];
  let best = null;
  for (const ax of axes) {
    const [minA, maxA] = project(cornersA, ax);
    const [minB, maxB] = project(cornersB, ax);
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      best = { depth: overlap, nx: ax.x, ny: ax.y };
    }
  }
  if ((B.x - A.x) * best.nx + (B.y - A.y) * best.ny < 0) {
    best.nx = -best.nx;
    best.ny = -best.ny;
  }
  return best;
}

function pointInOBB(p, cx, cy, heading, L, W) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= L / 2 && Math.abs(ly) <= W / 2;
}

function contactPoint(A, B, a, b, cornersA, cornersB) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of cornersA) {
    if (pointInOBB(p, B.x, B.y, B.heading, b.L, b.W)) {
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  for (const p of cornersB) {
    if (pointInOBB(p, A.x, A.y, A.heading, a.L, a.W)) {
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  if (n === 0) return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  return { x: sx / n, y: sy / n };
}
