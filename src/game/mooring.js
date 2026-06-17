// Mooring lines: ropes from the boat's cleats to dock cleats / bollards.
//
// Each line is pull-only (a rope, not a rod): no force while there is slack,
// a spring-damper tension once the boat drifts past the line's rest length.
// The force is applied at the boat-frame cleat, so a taut line both slows the
// hull AND yaws it — exactly the lever-arm behaviour used when warping a boat
// off a dock (gun ahead against a bow spring and the stern walks out).

import {
  MASS,
  I_Z,
  BOAT_LENGTH,
  BOAT_WIDTH,
  MOORING_STIFF,
  MOORING_DAMP,
  MOORING_MAX_FORCE,
  MOORING_MIN_LEN,
  MOORING_MAX_LEN,
} from './constants.js';

// Boat cleats in body frame (+x = bow, +y = starboard), metres.
export const BOAT_CLEATS = [
  { id: 'bow-p',   bx: BOAT_LENGTH * 0.42,  by: -BOAT_WIDTH * 0.4 },
  { id: 'bow-s',   bx: BOAT_LENGTH * 0.42,  by:  BOAT_WIDTH * 0.4 },
  { id: 'mid',     bx: 0,                   by: 0 },
  { id: 'stern-p', bx: -BOAT_LENGTH * 0.42, by: -BOAT_WIDTH * 0.4 },
  { id: 'stern-s', bx: -BOAT_LENGTH * 0.42, by:  BOAT_WIDTH * 0.4 },
];

// World position of a boat cleat (and its CG-relative offset for torque).
export function cleatWorld(boat, c) {
  const cs = Math.cos(boat.heading);
  const sn = Math.sin(boat.heading);
  const rx = c.bx * cs - c.by * sn;
  const ry = c.bx * sn + c.by * cs;
  return { x: boat.x + rx, y: boat.y + ry, rx, ry };
}

// All anchor points lines can attach to: dock corner cleats + bollards.
export function mooringPoints(world) {
  const pts = [];
  for (const e of world.entities) {
    if (e.category === 'dock') {
      const cs = Math.cos(e.heading);
      const sn = Math.sin(e.heading);
      const corners = [
        [e.length * 0.4, e.width * 0.42],
        [e.length * 0.4, -e.width * 0.42],
        [-e.length * 0.4, e.width * 0.42],
        [-e.length * 0.4, -e.width * 0.42],
      ];
      for (const [lx, ly] of corners) {
        pts.push({ entityId: e.id, lx, ly, wx: e.x + lx * cs - ly * sn, wy: e.y + lx * sn + ly * cs });
      }
    } else if (e.category === 'bollard') {
      pts.push({ entityId: e.id, lx: 0, ly: 0, wx: e.x, wy: e.y });
    }
  }
  return pts;
}

// World position of a line's fixed (dock-side) anchor — null if the entity
// it was tied to has since been deleted.
export function anchorWorld(world, line) {
  const e = world.entities.find((en) => en.id === line.entityId);
  if (!e) return null;
  const cs = Math.cos(e.heading);
  const sn = Math.sin(e.heading);
  return { x: e.x + line.lx * cs - line.ly * sn, y: e.y + line.lx * sn + line.ly * cs };
}

// Create a line from a boat cleat to a mooring point. Rest length defaults to
// the current span (made-fast taut) but never shorter than the minimum.
export function createMooringLine(world, cleat, point) {
  const cw = cleatWorld(world.boat, cleat);
  const dist = Math.hypot(point.wx - cw.x, point.wy - cw.y);
  const id = world.mooring.nextId++;
  world.mooring.lines.push({
    id,
    cleatId: cleat.id,
    bx: cleat.bx,
    by: cleat.by,
    entityId: point.entityId,
    lx: point.lx,
    ly: point.ly,
    restLength: Math.max(MOORING_MIN_LEN, dist),
  });
  return id;
}

export function removeMooringLine(world, id) {
  const i = world.mooring.lines.findIndex((l) => l.id === id);
  if (i >= 0) world.mooring.lines.splice(i, 1);
}

export function adjustMooringLength(world, id, delta) {
  const l = world.mooring.lines.find((x) => x.id === id);
  if (!l) return;
  l.restLength = Math.max(MOORING_MIN_LEN, Math.min(MOORING_MAX_LEN, l.restLength + delta));
}

// Current span / tension state of a line (for the panel + colour-coding).
export function lineState(world, line) {
  const cw = cleatWorld(world.boat, line);
  const a = anchorWorld(world, line);
  if (!a) return { dist: 0, taut: false, dead: true };
  const dist = Math.hypot(a.x - cw.x, a.y - cw.y);
  return { dist, taut: dist > line.restLength + 0.05, dead: false };
}

// Apply rope tension to the boat. Called once per fixed step in drive mode.
export function applyMooring(world, dt) {
  const m = world.mooring;
  if (!m || m.lines.length === 0) return;
  const b = world.boat;
  const ms = b.massScale > 0 ? b.massScale : 1;
  const mass = MASS * ms;
  const izz = I_Z * ms;
  const cs = Math.cos(b.heading);
  const sn = Math.sin(b.heading);

  let Fx = 0;
  let Fy = 0;
  let tau = 0;
  const dead = [];

  for (const line of m.lines) {
    const e = world.entities.find((en) => en.id === line.entityId);
    if (!e) { dead.push(line.id); continue; }
    const acs = Math.cos(e.heading);
    const asn = Math.sin(e.heading);
    const ax = e.x + line.lx * acs - line.ly * asn;
    const ay = e.y + line.lx * asn + line.ly * acs;

    const rx = line.bx * cs - line.by * sn;
    const ry = line.bx * sn + line.by * cs;
    const cx = b.x + rx;
    const cy = b.y + ry;

    const dx = ax - cx;
    const dy = ay - cy;
    const dist = Math.hypot(dx, dy);
    if (dist <= line.restLength || dist < 1e-4) continue; // slack → no force

    const ux = dx / dist;
    const uy = dy / dist;
    const stretch = dist - line.restLength;

    // Cleat velocity = v + ω × r.
    const vcx = b.vx - b.omega * ry;
    const vcy = b.vy + b.omega * rx;
    const vrel = vcx * ux + vcy * uy; // +toward anchor (slackening)

    let T = MOORING_STIFF * stretch - MOORING_DAMP * vrel;
    if (T < 0) T = 0;            // rope can't push
    if (T > MOORING_MAX_FORCE) T = MOORING_MAX_FORCE;

    const fx = ux * T;
    const fy = uy * T;
    Fx += fx;
    Fy += fy;
    tau += rx * fy - ry * fx;
  }

  for (const id of dead) removeMooringLine(world, id);

  b.vx += (Fx / mass) * dt;
  b.vy += (Fy / mass) * dt;
  b.omega += (tau / izz) * dt;
}
