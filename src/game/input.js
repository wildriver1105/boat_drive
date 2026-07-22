// Input router. Handles:
//   • Keyboard state for the boat (W/S/A/D, arrows, Space)
//   • Mouse drag on the throttle handle and the helm wheel (drive mode)
//   • Edit-mode interactions: click to place / select, drag to move,
//     [ ] (or wheel) to rotate — hold Shift for 45° snapping, Delete to remove
//
// While world.edit.mode is true, pointer events are routed to the editor
// instead of the throttle / helm widgets (which are hidden anyway).

import {
  hitTestThrottle,
  throttleLayout,
  yToThrottleValue,
  helmLayout,
  hitTestHelm,
  thrusterLayout,
  hitTestThruster,
} from './ui-layout.js';
import { HELM_MAX_ANGLE, PX_PER_M, MOORING_SNAP_M, MOORING_CLEAT_HIT_PX } from './constants.js';
import {
  createEntity,
  findEntityAt,
  snapDockPose,
  presetById,
  sizedTerrainPose,
  canSitOnTerrain,
  terrainOutline,
  ensureTerrainPoly,
  updateTerrainBounds,
} from './entities.js';
import { saveWorld } from './world.js';
import { BOAT_CLEATS, cleatWorld, mooringPoints, createMooringLine } from './mooring.js';

const ROTATE_FINE = Math.PI / 36; // 5° per step (free rotation)
const ROTATE_SNAP = Math.PI / 4;  // 45° increments when Shift is held

export function createInput({ canvas, world, onSelect }) {
  const keys = new Set();
  // Notify React when the editor selection changes (for the toolbar buttons).
  const notifySelect = () => {
    if (!onSelect) return;
    const id = world.edit.selectedId;
    const e = id == null ? null : world.entities.find((en) => en.id === id) || null;
    onSelect(e ? { id: e.id, presetId: e.presetId, category: e.category } : null);
  };
  let draggingThrottle = false;
  let draggingHelm = false;
  // Mouse-held thruster rocker: { unit: 'bow'|'stern', dir: -1|+1 } | null.
  // Momentary — active only while the button is physically held.
  let heldThruster = null;
  let prevHelmMouseAngle = 0;
  let hoverThrottle = false;
  let hoverHelm = false;
  let lastCursor = canvas.style.cursor || '';

  // ---------- Keyboard ----------

  const onKeyDown = (e) => {
    if (world.edit.mode) {
      if (handleEditKeyDown(e)) {
        e.preventDefault();
        return;
      }
    }
    if (isGameKey(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  };
  const onKeyUp = (e) => {
    if (isGameKey(e.code)) {
      keys.delete(e.code);
      e.preventDefault();
    }
  };
  const onBlur = () => keys.clear();

  function handleEditKeyDown(e) {
    if (e.code === 'Delete' || e.code === 'Backspace') {
      removeSelected();
      return true;
    }
    // [ / ] rotate the selection. With Shift, snap to 0/45/90/… increments.
    if (e.code === 'BracketLeft' || e.code === 'Comma') {
      if (e.shiftKey) rotateSnap(-1);
      else rotateSelected(-ROTATE_FINE);
      return true;
    }
    if (e.code === 'BracketRight' || e.code === 'Period') {
      if (e.shiftKey) rotateSnap(+1);
      else rotateSelected(+ROTATE_FINE);
      return true;
    }
    // - / = zoom the 3D edit camera (ignored by the 2D top-down view).
    if (e.code === 'Minus') {
      world.edit.camDist = Math.min(90, (world.edit.camDist || 40) + 5);
      return true;
    }
    if (e.code === 'Equal') {
      world.edit.camDist = Math.max(18, (world.edit.camDist || 40) - 5);
      return true;
    }
    if (e.code === 'Escape') {
      world.edit.sizing = null; // cancel an in-progress terrain drag
      world.edit.vertexDrag = null;
      world.edit.selectedId = null;
      notifySelect();
      return true;
    }
    return false;
  }

  function removeSelected() {
    const id = world.edit.selectedId;
    if (id == null) return;
    const idx = world.entities.findIndex((en) => en.id === id);
    if (idx >= 0) {
      world.entities.splice(idx, 1);
      world.edit.selectedId = null;
      world.edit.dragging = false;
      notifySelect();
      saveWorld(world);
    }
  }

  function selectedEntity() {
    const id = world.edit.selectedId;
    if (id == null) return null;
    return world.entities.find((en) => en.id === id) || null;
  }

  function normalizeHeading(h) {
    if (h > Math.PI) return h - 2 * Math.PI;
    if (h <= -Math.PI) return h + 2 * Math.PI;
    return h;
  }

  // Free rotation by a fixed delta.
  function rotateSelected(delta) {
    const e = selectedEntity();
    if (!e) return;
    e.heading = normalizeHeading(e.heading + delta);
    saveWorld(world);
  }

  // Snap rotation: step to the next 45° increment in direction `dir` (±1).
  function rotateSnap(dir) {
    const e = selectedEntity();
    if (!e) return;
    const cur = e.heading;
    // Round to the nearest increment first, then step one notch over so a
    // press always moves (even from an already-aligned angle).
    const k = Math.round(cur / ROTATE_SNAP);
    let next = (k + dir) * ROTATE_SNAP;
    // If current wasn't aligned, snapping toward dir should land on the
    // adjacent aligned angle rather than skipping one.
    const aligned = Math.abs(cur - k * ROTATE_SNAP) < 1e-3;
    if (!aligned) next = (dir > 0 ? Math.ceil(cur / ROTATE_SNAP) : Math.floor(cur / ROTATE_SNAP)) * ROTATE_SNAP;
    e.heading = normalizeHeading(next);
    saveWorld(world);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ---------- Pointer helpers ----------

  function pointFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x, y,
      width: rect.width,
      height: rect.height,
      layoutT: throttleLayout(rect.width, rect.height),
      layoutH: helmLayout(rect.width, rect.height),
      layoutTh: thrusterLayout(rect.width, rect.height),
    };
  }

  // Optional external unprojection (3D edit view): maps a screen point to
  // the water plane through the live 3D camera. When it returns a point the
  // whole editor — selection, drags, placement, terrain sizing, vertex
  // handles — runs in the 3D view unchanged, because everything downstream
  // only ever consumes world coordinates.
  let worldPicker = null;
  function setWorldPicker(fn) {
    worldPicker = fn;
  }

  function screenToWorld(sx, sy, width, height) {
    if (world.edit.mode && worldPicker) {
      const p = worldPicker(sx, sy, width, height);
      if (p) return p;
    }
    return {
      x: world.camera.x + (sx - width / 2) / PX_PER_M,
      y: world.camera.y + (sy - height / 2) / PX_PER_M,
    };
  }

  // ---------- Mooring (drag a line from a boat cleat to a dock/bollard) ----------

  // Start a line drag if the press landed on a boat cleat. Returns true if so.
  function mooringDown(x, y, width, height) {
    const cam = world.camera;
    for (const c of BOAT_CLEATS) {
      const cw = cleatWorld(world.boat, c);
      const sx = width / 2 + (cw.x - cam.x) * PX_PER_M;
      const sy = height / 2 + (cw.y - cam.y) * PX_PER_M;
      if (Math.hypot(sx - x, sy - y) <= MOORING_CLEAT_HIT_PX) {
        const wp = screenToWorld(x, y, width, height);
        world.mooring.drag = { cleat: c, x: wp.x, y: wp.y };
        return true;
      }
    }
    return false;
  }

  function mooringMove(x, y, width, height) {
    const d = world.mooring.drag;
    if (!d) return;
    const wp = screenToWorld(x, y, width, height);
    d.x = wp.x;
    d.y = wp.y;
  }

  function mooringUp(x, y, width, height) {
    const d = world.mooring.drag;
    if (!d) return;
    const wp = screenToWorld(x, y, width, height);
    // Snap to the nearest dock cleat / bollard within range.
    let best = null;
    let bestD = MOORING_SNAP_M;
    for (const pt of mooringPoints(world)) {
      const dd = Math.hypot(pt.wx - wp.x, pt.wy - wp.y);
      if (dd < bestD) { bestD = dd; best = pt; }
    }
    if (best) createMooringLine(world, d.cleat, best);
    world.mooring.drag = null;
  }

  function updateCursor() {
    let next;
    if (world.edit.mode) {
      next = world.edit.dragging ? 'grabbing' : 'crosshair';
    } else if (draggingThrottle || draggingHelm) {
      next = 'grabbing';
    } else if (hoverThrottle || hoverHelm) {
      next = 'grab';
    } else {
      next = 'crosshair';
    }
    if (next !== lastCursor) {
      canvas.style.cursor = next;
      lastCursor = next;
    }
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function applyHelmDrag(x, y, layoutH) {
    const curAngle = Math.atan2(y - layoutH.cy, x - layoutH.cx);
    let dAngle = curAngle - prevHelmMouseAngle;
    while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
    while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    prevHelmMouseAngle = curAngle;
    const rudderDelta = dAngle / HELM_MAX_ANGLE;
    world.boat.rudderTarget = clamp(world.boat.rudderTarget + rudderDelta, -1, 1);
  }

  // ---------- Edit-mode pointer ----------

  // World point → the entity's local frame.
  function worldToLocal(e, wp) {
    const cosH = Math.cos(e.heading);
    const sinH = Math.sin(e.heading);
    const dx = wp.x - e.x;
    const dy = wp.y - e.y;
    return { lx: dx * cosH + dy * sinH, ly: -dx * sinH + dy * cosH };
  }

  // Which reshape handle of the selected terrain is under the point?
  // Vertices win over edge midpoints. Returns { index, mid, lx, ly } or null.
  const HANDLE_HIT_M = 14 / PX_PER_M;
  function hitTerrainHandle(e, wp) {
    const outline = terrainOutline(e);
    const local = worldToLocal(e, wp);
    for (let i = 0; i < outline.length; i++) {
      const [vx, vy] = outline[i];
      if (Math.hypot(local.lx - vx, local.ly - vy) <= HANDLE_HIT_M) {
        return { index: i, mid: false, lx: vx, ly: vy };
      }
    }
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % outline.length];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      if (Math.hypot(local.lx - mx, local.ly - my) <= HANDLE_HIT_M * 0.85) {
        return { index: i, mid: true, lx: mx, ly: my };
      }
    }
    return null;
  }

  function handleEditMouseDown(x, y, width, height) {
    const wp = screenToWorld(x, y, width, height);
    const tool = world.edit.tool;

    // Reshape handles on the SELECTED terrain take priority: grab a vertex
    // to move it, grab an edge midpoint to insert a new vertex there.
    const selTerrain = world.entities.find(
      (en) => en.id === world.edit.selectedId && en.category === 'terrain'
    );
    if (selTerrain) {
      const grab = hitTerrainHandle(selTerrain, wp);
      if (grab) {
        ensureTerrainPoly(selTerrain);
        let index = grab.index;
        if (grab.mid) {
          selTerrain.poly.splice(grab.index + 1, 0, [grab.lx, grab.ly]);
          index = grab.index + 1;
        }
        selTerrain.polyRev = (selTerrain.polyRev || 0) + 1;
        world.edit.vertexDrag = { id: selTerrain.id, index };
        world.edit.dirty = true;
        updateCursor();
        return;
      }
    }

    // Clicking an existing entity selects it (and starts a move drag) — in
    // ANY tool, so you never stack a new item on top of one you meant to
    // grab. Placement only happens on open water. Rotation is keyboard-only
    // ([ / ], Shift for 45° snap) so it never fights placement.
    const hit = findEntityAt(wp.x, wp.y, world.entities);
    // Fixed aids (beacons / lighthouse / bollard) may be planted ON terrain:
    // with such a tool armed, clicking a terrain entity places instead of
    // selecting it.
    const toolPreset = tool !== 'select' ? presetById(tool) : null;
    const plantOnTerrain =
      hit && hit.category === 'terrain' && canSitOnTerrain(toolPreset);
    if (hit && !plantOnTerrain) {
      world.edit.selectedId = hit.id;
      world.edit.dragging = true;
      world.edit.dragOffset = { x: wp.x - hit.x, y: wp.y - hit.y };
    } else if (tool !== 'select' && presetById(tool)?.category === 'terrain') {
      // Terrain is drawn, not stamped: anchor here, drag to set length+heading.
      world.edit.sizing = { presetId: tool, x0: wp.x, y0: wp.y, x1: wp.x, y1: wp.y };
      world.edit.selectedId = null;
      world.edit.dragging = false;
    } else if (tool !== 'select') {
      const entity = createEntity(tool, wp.x, wp.y);
      if (entity) {
        // Docks snap end-to-end to a nearby dock on placement.
        const snap = snapDockPose(entity, world.entities);
        if (snap) {
          entity.x = snap.x;
          entity.y = snap.y;
          entity.heading = snap.heading;
        }
        world.entities.push(entity);
        world.edit.selectedId = entity.id;
        world.edit.dragging = true;
        world.edit.dragOffset = { x: wp.x - entity.x, y: wp.y - entity.y };
        world.edit.dirty = true;
      }
    } else {
      world.edit.selectedId = null;
      world.edit.dragging = false;
    }
    notifySelect();
    updateCursor();
  }

  function handleEditMouseMove(x, y, width, height) {
    if (world.edit.vertexDrag) {
      const wp = screenToWorld(x, y, width, height);
      const d = world.edit.vertexDrag;
      const e = world.entities.find((en) => en.id === d.id);
      if (e && Array.isArray(e.poly) && e.poly[d.index]) {
        const local = worldToLocal(e, wp);
        e.poly[d.index] = [local.lx, local.ly];
        updateTerrainBounds(e);
        e.polyRev = (e.polyRev || 0) + 1;
        world.edit.dirty = true;
      }
      return;
    }
    if (world.edit.sizing) {
      const wp = screenToWorld(x, y, width, height);
      world.edit.sizing.x1 = wp.x;
      world.edit.sizing.y1 = wp.y;
      return;
    }
    if (!world.edit.dragging) return;
    const wp = screenToWorld(x, y, width, height);
    const e = world.entities.find((en) => en.id === world.edit.selectedId);
    if (!e) return;
    {
      e.x = wp.x - world.edit.dragOffset.x;
      e.y = wp.y - world.edit.dragOffset.y;
      // Docks snap end-to-end to a nearby dock while dragging.
      if (e.category === 'dock') {
        const snap = snapDockPose(e, world.entities);
        if (snap) {
          e.x = snap.x;
          e.y = snap.y;
          e.heading = snap.heading;
        }
      }
      world.edit.dirty = true;
    }
  }

  function handleEditMouseUp() {
    if (world.edit.vertexDrag) {
      const d = world.edit.vertexDrag;
      world.edit.vertexDrag = null;
      const e = world.entities.find((en) => en.id === d.id);
      // Dropping a vertex onto a neighbour merges them (vector-editor style
      // delete) — as long as the polygon keeps at least a triangle.
      if (e && Array.isArray(e.poly) && e.poly.length > 3 && e.poly[d.index]) {
        const n = e.poly.length;
        const p = e.poly[d.index];
        const prev = e.poly[(d.index - 1 + n) % n];
        const next = e.poly[(d.index + 1) % n];
        const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.8;
        if (near(p, prev) || near(p, next)) {
          e.poly.splice(d.index, 1);
          e.polyRev = (e.polyRev || 0) + 1;
          updateTerrainBounds(e);
        }
      }
      saveWorld(world);
      updateCursor();
      return;
    }
    if (world.edit.sizing) {
      const s = world.edit.sizing;
      world.edit.sizing = null;
      const p = presetById(s.presetId);
      if (p) {
        const pose = sizedTerrainPose(p, s.x0, s.y0, s.x1, s.y1);
        const entity = createEntity(s.presetId, pose.x, pose.y, pose.heading);
        if (entity) {
          entity.length = pose.length;
          entity.width = pose.width;
          world.entities.push(entity);
          world.edit.selectedId = entity.id;
          world.edit.dirty = true;
          saveWorld(world);
          notifySelect();
        }
      }
      updateCursor();
      return;
    }
    if (world.edit.dragging) {
      world.edit.dragging = false;
      saveWorld(world);
      updateCursor();
    }
  }

  function handleEditWheel(deltaY, shiftKey) {
    if (world.edit.selectedId == null) return;
    const dir = deltaY > 0 ? 1 : -1;
    if (shiftKey) rotateSnap(dir);
    else rotateSelected(dir * ROTATE_FINE);
  }

  // ---------- Mouse ----------

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const p = pointFromClient(e.clientX, e.clientY);

    if (world.edit.mode) {
      handleEditMouseDown(p.x, p.y, p.width, p.height);
      e.preventDefault();
      return;
    }

    // Mooring mode: grabbing a boat cleat starts a line drag. If the press
    // wasn't on a cleat, fall through so the helm/throttle still work.
    if (world.mooring.mode && mooringDown(p.x, p.y, p.width, p.height)) {
      e.preventDefault();
      return;
    }

    if (hitTestThrottle(p.x, p.y, p.layoutT)) {
      draggingThrottle = true;
      world.boat.throttleTarget = yToThrottleValue(p.y, p.layoutT);
      updateCursor();
      e.preventDefault();
    } else if (hitTestHelm(p.x, p.y, p.layoutH)) {
      draggingHelm = true;
      prevHelmMouseAngle = Math.atan2(p.y - p.layoutH.cy, p.x - p.layoutH.cx);
      updateCursor();
      e.preventDefault();
    } else {
      const th = hitTestThruster(p.x, p.y, p.layoutTh);
      if (th) {
        heldThruster = th;
        updateCursor();
        e.preventDefault();
      }
    }
  };
  const onMouseMove = (e) => {
    const p = pointFromClient(e.clientX, e.clientY);

    if (world.mooring.drag) {
      mooringMove(p.x, p.y, p.width, p.height);
      e.preventDefault();
      return;
    }

    if (world.edit.mode) {
      handleEditMouseMove(p.x, p.y, p.width, p.height);
      // Placement-ghost anchor: only while idle and actually over the
      // canvas (not the toolbar or other HTML overlays).
      if (!world.edit.dragging && e.target === canvas) {
        world.edit.hover = screenToWorld(p.x, p.y, p.width, p.height);
      } else {
        world.edit.hover = null;
      }
      updateCursor();
      if (world.edit.dragging) e.preventDefault();
      return;
    }

    hoverThrottle = !draggingHelm && hitTestThrottle(p.x, p.y, p.layoutT);
    hoverHelm = !draggingThrottle && hitTestHelm(p.x, p.y, p.layoutH);
    if (draggingThrottle) {
      world.boat.throttleTarget = yToThrottleValue(p.y, p.layoutT);
      e.preventDefault();
    } else if (draggingHelm) {
      applyHelmDrag(p.x, p.y, p.layoutH);
      e.preventDefault();
    }
    updateCursor();
  };
  const onMouseUp = (e) => {
    if (world.mooring.drag) {
      const p = pointFromClient(e.clientX, e.clientY);
      mooringUp(p.x, p.y, p.width, p.height);
      e.preventDefault();
      return;
    }
    if (world.edit.mode) {
      handleEditMouseUp();
      e.preventDefault();
      return;
    }
    if (draggingThrottle || draggingHelm || heldThruster) {
      draggingThrottle = false;
      draggingHelm = false;
      heldThruster = null; // momentary — release = neutral
      updateCursor();
      e.preventDefault();
    }
  };
  const onMouseLeave = () => {
    hoverThrottle = false;
    hoverHelm = false;
    world.edit.hover = null;
    updateCursor();
  };

  const onWheel = (e) => {
    if (!world.edit.mode) return;
    if (world.edit.selectedId == null) return;
    handleEditWheel(e.deltaY, e.shiftKey);
    e.preventDefault();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // ---------- Touch ----------

  const onTouchStart = (e) => {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const p = pointFromClient(t.clientX, t.clientY);

    if (world.edit.mode) {
      handleEditMouseDown(p.x, p.y, p.width, p.height);
      e.preventDefault();
      return;
    }

    if (world.mooring.mode && mooringDown(p.x, p.y, p.width, p.height)) {
      e.preventDefault();
      return;
    }

    if (hitTestThrottle(p.x, p.y, p.layoutT)) {
      draggingThrottle = true;
      world.boat.throttleTarget = yToThrottleValue(p.y, p.layoutT);
      e.preventDefault();
    } else if (hitTestHelm(p.x, p.y, p.layoutH)) {
      draggingHelm = true;
      prevHelmMouseAngle = Math.atan2(p.y - p.layoutH.cy, p.x - p.layoutH.cx);
      e.preventDefault();
    } else {
      const th = hitTestThruster(p.x, p.y, p.layoutTh);
      if (th) {
        heldThruster = th;
        e.preventDefault();
      }
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const p = pointFromClient(t.clientX, t.clientY);

    if (world.mooring.drag) {
      mooringMove(p.x, p.y, p.width, p.height);
      e.preventDefault();
      return;
    }

    if (world.edit.mode) {
      handleEditMouseMove(p.x, p.y, p.width, p.height);
      if (world.edit.dragging || world.edit.sizing || world.edit.vertexDrag) e.preventDefault();
      return;
    }

    if (!draggingThrottle && !draggingHelm) return;
    if (draggingThrottle) {
      world.boat.throttleTarget = yToThrottleValue(p.y, p.layoutT);
    } else if (draggingHelm) {
      applyHelmDrag(p.x, p.y, p.layoutH);
    }
    e.preventDefault();
  };
  const onTouchEnd = () => {
    if (world.mooring.drag) {
      const d = world.mooring.drag;
      // No release coords on touchend; finalize at the last drag world pos.
      const cam = world.camera;
      mooringUp(
        canvas.clientWidth / 2 + (d.x - cam.x) * PX_PER_M,
        canvas.clientHeight / 2 + (d.y - cam.y) * PX_PER_M,
        canvas.clientWidth, canvas.clientHeight
      );
      return;
    }
    if (world.edit.mode) {
      handleEditMouseUp();
      return;
    }
    draggingThrottle = false;
    draggingHelm = false;
    heldThruster = null;
  };
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('touchcancel', onTouchEnd);

  return {
    setWorldPicker,
    getKeys() {
      // Momentary thruster command: keyboard and on-screen rocker combine.
      let bow = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
      let stern = (keys.has('KeyC') ? 1 : 0) - (keys.has('KeyZ') ? 1 : 0);
      if (heldThruster) {
        if (heldThruster.unit === 'bow') bow += heldThruster.dir;
        else stern += heldThruster.dir;
      }
      return {
        throttleUp: keys.has('KeyW') || keys.has('ArrowUp'),
        throttleDown: keys.has('KeyS') || keys.has('ArrowDown'),
        rudderLeft: keys.has('KeyA') || keys.has('ArrowLeft'),
        rudderRight: keys.has('KeyD') || keys.has('ArrowRight'),
        neutral: keys.has('Space'),
        bowThruster: bow,
        sternThruster: stern,
        mouseDraggingThrottle: draggingThrottle,
        mouseDraggingHelm: draggingHelm,
      };
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      keys.clear();
    },
  };
}

function isGameKey(code) {
  return (
    code === 'KeyW' ||
    code === 'KeyA' ||
    code === 'KeyS' ||
    code === 'KeyD' ||
    code === 'KeyQ' ||
    code === 'KeyE' ||
    code === 'KeyZ' ||
    code === 'KeyC' ||
    code === 'ArrowUp' ||
    code === 'ArrowDown' ||
    code === 'ArrowLeft' ||
    code === 'ArrowRight' ||
    code === 'Space'
  );
}
