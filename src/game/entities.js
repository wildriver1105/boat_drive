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
  // Static boats
  { id: 'mono-small',  label: 'Dinghy',     category: 'boat', length: 4,  width: 1.6, hull: 'mono' },
  { id: 'mono-medium', label: 'Runabout',   category: 'boat', length: 7,  width: 2.4, hull: 'mono' },
  { id: 'mono-large',  label: 'Cruiser',    category: 'boat', length: 12, width: 3.6, hull: 'mono', cabin: true },
  { id: 'mono-yacht',  label: 'Yacht',      category: 'boat', length: 18, width: 4.5, hull: 'mono', cabin: true },
  { id: 'sailboat',    label: 'Sailboat',   category: 'boat', length: 9,  width: 2.8, hull: 'mono', sail: true },
  { id: 'catamaran',   label: 'Catamaran',  category: 'boat', length: 10, width: 5.5, hull: 'cat' },
];

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
