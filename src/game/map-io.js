// Map save / load / export / import.
//
// The exported JSON is a clean CARTESIAN description of the map:
//   • origin (0, 0) = the boat's start point (spawn), NOT a screen corner
//   • +x = east (right), +y = NORTH (up)  — standard maths/chart orientation
//   • units = metres, headings in degrees (CCW from east)
//
// Internally the sim uses +y = SOUTH (screen-down), so export/import flip the
// y-axis. A y-axis flip is a reflection, so to keep a rotated/`poly`-shaped
// entity identical after a round-trip we also negate the heading and each
// polygon vertex's local y. The transform is its own inverse (an involution),
// so the same function converts both directions.

import { createEntity } from './entities.js';

const LIB_KEY = 'boat_drive.maps.v1';
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function round(n, p = 100) {
  return Math.round(n * p) / p;
}

// ---- internal entity  →  Cartesian (north-up) record ----
function entityToCartesian(e) {
  const rec = {
    presetId: e.presetId,
    category: e.category,
    x: round(e.x),
    y: round(-e.y), // +y = north
    headingDeg: round(-e.heading * DEG, 10),
    length: round(e.length),
    width: round(e.width),
  };
  if (e.hull) rec.hull = e.hull;
  if (e.sail !== undefined && e.sail !== false) rec.sail = e.sail;
  if (e.cabin) rec.cabin = e.cabin;
  if (e.beacon) rec.beacon = e.beacon;
  if (e.mark) rec.mark = e.mark;
  if (e.aid) rec.aid = e.aid;
  if (e.terrain) rec.terrain = e.terrain;
  if (e.height !== undefined) rec.height = round(e.height);
  if (Array.isArray(e.poly) && e.poly.length >= 3) {
    rec.poly = e.poly.map(([lx, ly]) => [round(lx), round(-ly)]);
  }
  return rec;
}

// ---- Cartesian record  →  internal entity (fresh id) ----
function cartesianToEntity(rec) {
  if (!rec || typeof rec.presetId !== 'string') return null;
  if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y)) return null;
  const hRad = -(Number(rec.headingDeg) || 0) * RAD;
  const e = createEntity(rec.presetId, rec.x, -rec.y, hRad);
  if (!e) return null; // unknown preset — skip
  if (Number.isFinite(rec.length) && rec.length > 0) e.length = rec.length;
  if (Number.isFinite(rec.width) && rec.width > 0) e.width = rec.width;
  if (rec.hull !== undefined) e.hull = rec.hull;
  if (rec.sail !== undefined) e.sail = rec.sail;
  if (rec.cabin !== undefined) e.cabin = rec.cabin;
  if (rec.beacon !== undefined) e.beacon = rec.beacon;
  if (rec.mark !== undefined) e.mark = rec.mark;
  if (rec.aid !== undefined) e.aid = rec.aid;
  if (rec.terrain !== undefined) e.terrain = rec.terrain;
  if (Number.isFinite(rec.height)) e.height = rec.height;
  if (Array.isArray(rec.poly) && rec.poly.length >= 3) {
    const poly = rec.poly
      .filter((v) => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]))
      .map(([lx, ly]) => [lx, -ly]);
    if (poly.length >= 3) {
      e.poly = poly;
      e.polyRev = 1;
    }
  }
  return e;
}

// ---- public: serialize / deserialize ----

export function serializeMap(world, meta = {}) {
  return {
    format: 'boat-drive-map',
    version: 1,
    axes: 'metres; origin = boat start point; +x = east (right), +y = north (up); headings degrees CCW from east',
    boatStart: { x: 0, y: 0 },
    ...meta,
    count: world.entities.length,
    entities: world.entities.map(entityToCartesian),
  };
}

// Returns a fresh array of internal entities (does not touch the world).
export function deserializeMap(json) {
  const list = json && Array.isArray(json.entities) ? json.entities : [];
  const out = [];
  for (const rec of list) {
    const e = cartesianToEntity(rec);
    if (e) out.push(e);
  }
  return out;
}

// ---- local library (named slots in localStorage) ----

function readLib() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed && parsed.maps) ? parsed.maps : [];
  } catch (e) {
    return [];
  }
}

function writeLib(maps) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify({ version: 1, maps }));
  } catch (e) {
    /* quota / disabled storage — ignore */
  }
}

export function listSavedMaps() {
  return readLib()
    .map((m) => ({ id: m.id, name: m.name, savedAt: m.savedAt, count: (m.data && m.data.count) || 0 }))
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

// Save (or overwrite by name) the current map. Returns the slot id.
export function saveMapToLibrary(world, name, savedAt) {
  const maps = readLib();
  const data = serializeMap(world, { name, savedAt });
  const idx = maps.findIndex((m) => m.name === name);
  const id =
    idx >= 0
      ? maps[idx].id
      : 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id, name, savedAt, data };
  if (idx >= 0) maps[idx] = entry;
  else maps.push(entry);
  writeLib(maps);
  return id;
}

export function loadMapFromLibrary(id) {
  const m = readLib().find((x) => x.id === id);
  return m ? deserializeMap(m.data) : null;
}

export function deleteSavedMap(id) {
  writeLib(readLib().filter((m) => m.id !== id));
}

// ---- file export / import (user-initiated) ----

export function downloadMapFile(world, filename) {
  if (typeof document === 'undefined') return;
  const json = serializeMap(world, { savedAt: new Date().toISOString() });
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'harbor-map.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parse a .json file's text → internal entities. Throws on invalid JSON /
// wrong format so the caller can surface an error.
export function parseMapText(text) {
  const json = JSON.parse(text);
  if (!json || !Array.isArray(json.entities)) {
    throw new Error('Not a boat-drive map file (no "entities" array).');
  }
  return deserializeMap(json);
}
