// Sample training harbor — a dense, realistic pilotage exercise modelled on
// a busy Korean fishing-port-plus-marina layout: twin rubble breakwaters with
// an offset entrance, a buoyed approach channel (IALA Region B — red to
// starboard entering), a commercial quay wall, a finger-pier marina, a
// mooring field, and outlying reefs / islands carrying the full set of chart
// marks. The player spawns at (0, 0) heading north (−y), lined up on the
// channel with the entrance dead ahead — chart-in-hand piloting from the
// first second.
//
// Everything is built through createEntity so ids are fresh and the result
// can simply replace world.entities.

import { createEntity } from './entities.js';

const D = [
  // ---------- Approach channel (from seaward, south of the entrance) ----------
  ['buoy-safewater', 2, 92, 0],          // landfall / safe water
  ['buoy-wreck', -34, 66, 0],            // new wreck south-west of the channel
  ['buoy-red', 9, 72, 0],                // pair 1 (red = starboard, Region B)
  ['buoy-green', -8, 74, 0],
  ['buoy-red', 8, 46, 0],                // pair 2
  ['buoy-green', -9, 48, 0],
  ['buoy-red', 7, 20, 0],                // pair 3
  ['buoy-green', -10, 22, 0],
  ['buoy-special', 20, 6, 0],            // restricted-area mark off the channel

  // East reef guarding the approach — pass WEST of the cardinal.
  ['rock-large', 36, 54, 0.4],
  ['rock-small', 30, 62, 0],
  ['buoy-card-w', 24, 58, 0],
  // West shoal with an isolated-danger mark.
  ['rock-small', -30, 38, 0],
  ['buoy-danger', -25, 42, 0],

  // ---------- Entrance: twin breakwaters + head lights ----------
  ['bw-long', 29, -10, -0.306],          // east breakwater (head at ~(10,−4))
  ['bw-long', -35, -13, -2.885],         // west breakwater (head at ~(−16,−8))
  ['buoy-lighthouse', 12, -2, 0],        // east head light (stbd entering)
  ['buoy-lighthouse', -18, -6, 0],       // west head light
  ['bollard', 14, -8, 0],
  ['bollard', -20, -12, 0],
  // Fixed beacons ON the works / hazards.
  ['bcn-lat-s', 22, -8, 0],              // red beacon on the east breakwater
  ['bcn-lat-p', -28, -12, 0],            // green beacon on the west breakwater
  ['bcn-danger', 36, 54, 0],             // isolated-danger beacon on the reef
  ['bcn-card-e', -72, 8, 0],             // east cardinal beacon on headland rocks

  // ---------- Inner harbour ----------
  // West commercial quay wall (two 30 m sections, wall running N–S).
  ['quay-wall', -42, -32, Math.PI / 2],
  ['quay-wall', -42, -62, Math.PI / 2],
  ['mono-yacht', -35.5, -38, Math.PI / 2],   // ship alongside
  ['mono-large', -35.5, -64, -Math.PI / 2],
  // North quay closing the basin, with high ground behind it.
  ['quay-wall', -12, -88, 0],
  ['island-hill', -14, -122, 0.2],

  // East marina: main pier (three 12 m sections) + finger piers.
  ['dock-long', 22, -24, Math.PI / 2],
  ['dock-long', 22, -36, Math.PI / 2],
  ['dock-long', 22, -48, Math.PI / 2],
  ['dock-mid', 15, -29, 0],
  ['dock-mid', 15, -43, 0],
  ['dock-mid', 29, -29, 0],
  ['dock-mid', 29, -43, 0],
  // Boats in the slips.
  ['mono-small', 11, -26.5, 0],
  ['sail-dinghy', 11, -40.5, 0],
  ['mono-small', 33, -26.5, Math.PI],
  ['catamaran', 36, -54, Math.PI / 2],
  // Mooring-ball field NE of the marina.
  ['buoy-mooring', 44, -28, 0],
  ['buoy-mooring', 50, -36, 0],
  ['buoy-mooring', 42, -42, 0],
  ['sail-dinghy', 50, -36.6, 0.4],
  // Inner hazard.
  ['rock-small', -50, -84, 0],

  // ---------- Coast & offshore (cruising legs + skyline) ----------
  // West headland with off-lying rocks — pass EAST of the cardinal.
  ['headland', -100, 18, 0.3],
  ['rock-large', -72, 8, 1.1],
  ['buoy-card-e', -58, 10, 0],
  // East island with its own light; pass SOUTH of the cardinal.
  ['island-hill', 95, 26, -0.4],
  ['buoy-lighthouse', 88, 20, 0],
  ['buoy-card-s', 92, 50, 0],
  // Preferred-channel junction seaward of the east island.
  ['buoy-pref-stbd', 40, 78, 0],
  ['buoy-pref-port', -20, 88, 0],
  // Far NE island + reef with a north cardinal.
  ['island-hill', 135, -105, -0.5],
  ['rock-large', 74, -64, 0.7],
  ['buoy-card-n', 72, -78, 0],
];

export function buildSampleHarbor() {
  const out = [];
  for (const [presetId, x, y, heading] of D) {
    const e = createEntity(presetId, x, y, heading);
    if (e) out.push(e);
  }
  return out;
}
