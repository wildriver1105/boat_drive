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
  // Buoys & marks — anchored to the seabed: immovable colliders. The `mark`
  // field selects the IALA chart-symbol treatment in both renderers. Lateral
  // colours follow IALA Region B (Korea/Japan/Americas): entering from
  // seaward, RED to starboard, GREEN to port.
  { id: 'buoy-red',        label: 'Red nun (stbd)',  category: 'buoy', length: 1.0, width: 1.0, mark: 'lat-s' },
  { id: 'buoy-green',      label: 'Green can (port)', category: 'buoy', length: 1.0, width: 1.0, mark: 'lat-p' },
  { id: 'buoy-pref-stbd',  label: 'Pref chan (RGR)', category: 'buoy', length: 1.0, width: 1.0, mark: 'pref-s' },
  { id: 'buoy-pref-port',  label: 'Pref chan (GRG)', category: 'buoy', length: 1.0, width: 1.0, mark: 'pref-p' },
  { id: 'buoy-card-n',     label: 'Cardinal N',      category: 'buoy', length: 1.2, width: 1.2, mark: 'card-n' },
  { id: 'buoy-card-e',     label: 'Cardinal E',      category: 'buoy', length: 1.2, width: 1.2, mark: 'card-e' },
  { id: 'buoy-card-s',     label: 'Cardinal S',      category: 'buoy', length: 1.2, width: 1.2, mark: 'card-s' },
  { id: 'buoy-card-w',     label: 'Cardinal W',      category: 'buoy', length: 1.2, width: 1.2, mark: 'card-w' },
  { id: 'buoy-danger',     label: 'Isolated danger', category: 'buoy', length: 1.2, width: 1.2, mark: 'danger' },
  { id: 'buoy-safewater',  label: 'Safe water',      category: 'buoy', length: 1.2, width: 1.2, mark: 'safe' },
  { id: 'buoy-special',    label: 'Special (×)',     category: 'buoy', length: 1.0, width: 1.0, mark: 'special' },
  { id: 'buoy-wreck',      label: 'Wreck (new)',     category: 'buoy', length: 1.2, width: 1.2, mark: 'wreck' },
  { id: 'buoy-yellow',     label: 'Race mark',       category: 'buoy', length: 1.2, width: 1.2 },
  { id: 'buoy-mooring',    label: 'Mooring ball',    category: 'buoy', length: 0.8, width: 0.8 },
  { id: 'buoy-lighthouse', label: 'Lighthouse',      category: 'buoy', length: 2.4, width: 2.4, beacon: true },
  // Bollard — a round mooring post you can only make lines fast to.
  { id: 'bollard',         label: 'Bollard',      category: 'bollard', length: 0.6, width: 0.6 },
  // Terrain — land masses and harbour works. All static colliders; `height`
  // is metres above the waterline and drives the 3D silhouette (a breakwater
  // you can't see over, a quay you look UP at from the helm, hills that give
  // the coast its skyline).
  // Terrain sizes are DEFAULTS / aspect templates — in the editor you drag
  // across the water to set each piece's length (and, for rocks/islands,
  // the whole footprint) freely.
  { id: 'bw-long',    label: 'Breakwater', category: 'terrain', terrain: 'breakwater', length: 40, width: 7,  height: 3.6 },
  { id: 'quay-wall',  label: 'Quay wall',  category: 'terrain', terrain: 'quay',       length: 30, width: 10, height: 2.4 },
  { id: 'rock-small', label: 'Rock',       category: 'terrain', terrain: 'rock',       length: 3,  width: 3,  height: 1.6 },
  { id: 'rock-large', label: 'Reef rocks', category: 'terrain', terrain: 'rock',       length: 8,  width: 6,  height: 2.6 },
  { id: 'island-hill',label: 'Island',     category: 'terrain', terrain: 'island',     length: 60, width: 42, height: 17 },
  { id: 'headland',   label: 'Headland',   category: 'terrain', terrain: 'island',     length: 90, width: 55, height: 24 },
];

export function presetById(presetId) {
  return ENTITY_PRESETS.find((p) => p.id === presetId) || null;
}

// ---------- Drag-to-size terrain placement ----------
// Terrain isn't placed at a fixed preset size: the user anchors a start
// point and DRAGS — the drag vector sets the length and the heading. Linear
// works (breakwater / quay) keep their engineering width; area features
// (rocks / islands) scale their whole footprint, preserving the preset's
// aspect ratio. Shared by the input layer (finalize) and the renderer
// (live ghost) so the preview is exactly what gets placed.

const TERRAIN_MIN_LEN = { breakwater: 6, quay: 8, rock: 2, island: 16 };
const TERRAIN_MAX_LEN = 300;

export function sizedTerrainPose(p, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  // A plain click (no meaningful drag) falls back to the preset's default
  // size, centred on the click — same as every other asset.
  if (dist < 1.2) {
    return { x: x0, y: y0, heading: 0, length: p.length, width: p.width, isClick: true };
  }
  const min = TERRAIN_MIN_LEN[p.terrain] || 3;
  const length = Math.min(TERRAIN_MAX_LEN, Math.max(min, dist));
  const width =
    p.terrain === 'rock' || p.terrain === 'island'
      ? length * (p.width / p.length)
      : p.width;
  const heading = Math.atan2(dy, dx);
  // Anchor the START of the drag: the piece grows from where you pressed.
  return {
    x: x0 + Math.cos(heading) * (length / 2),
    y: y0 + Math.sin(heading) * (length / 2),
    heading,
    length,
    width,
    isClick: false,
  };
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
    beacon: p.beacon,
    mark: p.mark,
    terrain: p.terrain,
    height: p.height,
  };
}

// Restore sequence counter when loading from storage so new ids don't collide.
export function reseedFromEntities(entities) {
  if (!Array.isArray(entities)) return;
  _seq = Math.max(_seq, entities.length);
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
