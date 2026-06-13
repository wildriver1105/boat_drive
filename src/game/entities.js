// Static world entities for the map editor.
//
// Two categories for now:
//   • dock — flat rectangular plank with cleats. Chain several together to
//     build a marina / mooring slips.
//   • boat — parked/moored static boat used as a docking obstacle. Multiple
//     hull presets so the user can practice around different sizes and
//     shapes (monohull dinghy → yacht, sailboat, catamaran).
//
// All entities are oriented rectangles in world coords: { x, y, heading,
// length (along bow-stern axis), width (across beam) }. The renderer and
// the hit-test treat that rectangle as the footprint; richer visuals are
// drawn on top of it.

export const ENTITY_PRESETS = [
  // Docks
  { id: 'dock-finger', label: 'Finger pier 3m', category: 'dock', length: 3, width: 1.0 },
  { id: 'dock-short',  label: 'Plank 4m',       category: 'dock', length: 4, width: 1.5 },
  { id: 'dock-mid',    label: 'Plank 8m',       category: 'dock', length: 8, width: 1.5 },
  { id: 'dock-long',   label: 'Plank 12m',      category: 'dock', length: 12, width: 1.8 },
  // Motorboats
  { id: 'mono-small',  label: 'Dinghy',      category: 'boat', length: 4,  width: 1.6, hull: 'mono' },
  { id: 'mono-large',  label: 'Cruiser',     category: 'boat', length: 12, width: 3.6, hull: 'mono', cabin: true },
  { id: 'mono-yacht',  label: 'Yacht',       category: 'boat', length: 18, width: 4.5, hull: 'mono', cabin: true },
  // Sailboats — the `sail` field encodes the rig type so the renderer
  // picks the right mast/sail layout.
  { id: 'sail-dinghy', label: 'Sail dinghy', category: 'boat', length: 4,  width: 1.5, hull: 'mono', sail: 'dinghy' },
  // Multihull
  { id: 'catamaran',   label: 'Catamaran',   category: 'boat', length: 10, width: 5.5, hull: 'cat' },
  // Buoys — anchored to the seabed: immovable colliders, never pushed.
  { id: 'buoy-red',     label: 'Red buoy',     category: 'buoy', length: 1.0, width: 1.0 },
  { id: 'buoy-green',   label: 'Green buoy',   category: 'buoy', length: 1.0, width: 1.0 },
  { id: 'buoy-yellow',  label: 'Race mark',    category: 'buoy', length: 1.2, width: 1.2 },
  { id: 'buoy-mooring', label: 'Mooring ball', category: 'buoy', length: 0.8, width: 0.8 },
];

export function presetById(presetId) {
  return ENTITY_PRESETS.find((p) => p.id === presetId) || null;
}

let _seq = 0;
function nextId() {
  _seq += 1;
  return `e_${Math.floor(Math.random() * 36 ** 4).toString(36)}_${_seq}`;
}

export function createEntity(presetId, x, y, heading = 0) {
  const p = ENTITY_PRESETS.find((q) => q.id === presetId);
  if (!p) return null;
  return {
    id: nextId(),
    presetId: p.id,
    category: p.category,
    x, y, heading,
    length: p.length,
    width: p.width,
    hull: p.hull,
    sail: p.sail,
    cabin: p.cabin,
  };
}

// Restore sequence counter when loading from storage so new ids don't collide.
export function reseedFromEntities(entities) {
  if (!Array.isArray(entities)) return;
  _seq = Math.max(_seq, entities.length);
}

// ---------- Rotation handle (editor) ----------
// A grab-able knob floating just beyond the bow of the selected entity.
// Geometry lives here so the renderer (drawing) and the input layer
// (hit-testing) stay in sync.

export const ROT_HANDLE_OFFSET_M = 1.4; // distance beyond the bow tip
export const ROT_HANDLE_RADIUS_M = 0.6; // visual radius
export const ROT_HANDLE_HIT_M = 1.1;    // generous grab radius

export function rotationHandlePos(e) {
  const d = e.length / 2 + ROT_HANDLE_OFFSET_M;
  return {
    x: e.x + Math.cos(e.heading) * d,
    y: e.y + Math.sin(e.heading) * d,
  };
}

export function hitTestRotationHandle(wx, wy, e) {
  const p = rotationHandlePos(e);
  const dx = wx - p.x;
  const dy = wy - p.y;
  return dx * dx + dy * dy <= ROT_HANDLE_HIT_M * ROT_HANDLE_HIT_M;
}

// Is the world-frame point (wx, wy) inside this entity's oriented rectangle?
export function pointInEntity(wx, wy, e) {
  const cosH = Math.cos(e.heading);
  const sinH = Math.sin(e.heading);
  const dx = wx - e.x;
  const dy = wy - e.y;
  // World → entity-local (same transform we use everywhere else for the boat).
  const lx =  dx * cosH + dy * sinH;
  const ly = -dx * sinH + dy * cosH;
  return Math.abs(lx) <= e.length / 2 && Math.abs(ly) <= e.width / 2;
}

// Topmost entity at world point (last in array wins, since later = drawn on top).
export function findEntityAt(wx, wy, entities) {
  for (let i = entities.length - 1; i >= 0; i--) {
    if (pointInEntity(wx, wy, entities[i])) return entities[i];
  }
  return null;
}

// ---------- Dock magnetic snapping ----------
// Docks join along their SHORT edges (the ends, at ±length/2). When the
// end of the dock being placed/dragged comes within DOCK_SNAP_RADIUS_M of
// another dock's end, snapDockPose returns a pose that makes them meet
// flush and collinear — so you can chain planks into a continuous pier.

export const DOCK_SNAP_RADIUS_M = 1.7;

// The two short-edge centers (ends) of a dock in world coords.
// `s` is +1 for the bow-side end, -1 for the stern-side end.
function dockEnds(e) {
  const c = Math.cos(e.heading);
  const s = Math.sin(e.heading);
  const half = e.length / 2;
  return [
    { s: 1, x: e.x + c * half, y: e.y + s * half },
    { s: -1, x: e.x - c * half, y: e.y - s * half },
  ];
}

// If `moving` (a dock) has an end near another dock's end, return a snapped
// pose { x, y, heading } that joins them end-to-end and collinear. Null if
// nothing is within range or `moving` isn't a dock.
export function snapDockPose(moving, entities, radius = DOCK_SNAP_RADIUS_M) {
  if (!moving || moving.category !== 'dock') return null;
  const myEnds = dockEnds(moving);
  const halfLen = moving.length / 2;
  let best = null;
  for (const o of entities) {
    if (o === moving || o.id === moving.id || o.category !== 'dock') continue;
    const oEnds = dockEnds(o);
    for (const me of myEnds) {
      for (const oe of oEnds) {
        const d = Math.hypot(me.x - oe.x, me.y - oe.y);
        if (d > radius || (best && d >= best.dist)) continue;
        // Collinear: our connecting end faces theirs, dock extends outward.
        // Same end-sign → antiparallel (heading + π); opposite → same heading.
        const th = o.heading + (me.s * oe.s > 0 ? Math.PI : 0);
        const x = oe.x - me.s * halfLen * Math.cos(th);
        const y = oe.y - me.s * halfLen * Math.sin(th);
        best = { dist: d, x, y, heading: th };
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, heading: best.heading };
}
