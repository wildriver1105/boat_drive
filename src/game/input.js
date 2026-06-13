// Input router. Handles:
//   • Keyboard state for the boat (W/S/A/D, arrows, Space)
//   • Mouse drag on the throttle handle and the helm wheel (drive mode)
//   • Edit-mode interactions: click to place / select, drag to move,
//     wheel / [ ] to rotate, Delete to remove
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
import { HELM_MAX_ANGLE, PX_PER_M } from './constants.js';
import {
  createEntity,
  findEntityAt,
  hitTestRotationHandle,
  snapDockPose,
} from './entities.js';
import { saveWorld } from './world.js';

const ROTATE_STEP = Math.PI / 12; // 15° per key press / wheel notch

export function createInput({ canvas, world }) {
  const keys = new Set();
  let draggingThrottle = false;
  let draggingHelm = false;
  let rotatingEntity = false;
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
    if (e.code === 'BracketLeft') {
      rotateSelected(-ROTATE_STEP);
      return true;
    }
    if (e.code === 'BracketRight') {
      rotateSelected(+ROTATE_STEP);
      return true;
    }
    if (e.code === 'Escape') {
      world.edit.selectedId = null;
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
      saveWorld(world);
    }
  }

  function rotateSelected(delta) {
    const id = world.edit.selectedId;
    if (id == null) return;
    const e = world.entities.find((en) => en.id === id);
    if (!e) return;
    e.heading += delta;
    // Normalize for cleanliness.
    if (e.heading > Math.PI) e.heading -= 2 * Math.PI;
    else if (e.heading <= -Math.PI) e.heading += 2 * Math.PI;
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

  function screenToWorld(sx, sy, width, height) {
    return {
      x: world.camera.x + (sx - width / 2) / PX_PER_M,
      y: world.camera.y + (sy - height / 2) / PX_PER_M,
    };
  }

  function updateCursor() {
    let next;
    if (world.edit.mode) {
      next = world.edit.dragging || rotatingEntity ? 'grabbing' : 'crosshair';
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

  function handleEditMouseDown(x, y, width, height) {
    const wp = screenToWorld(x, y, width, height);
    const tool = world.edit.tool;

    // 1) Rotation handle of the current selection starts a rotate drag —
    //    but ONLY with the Select tool. While a placement tool is active the
    //    handle is inert (and not drawn), so it can't hijack a click meant
    //    to place a new item close to the selected one.
    const selected = world.entities.find((en) => en.id === world.edit.selectedId);
    if (tool === 'select' && selected && hitTestRotationHandle(wp.x, wp.y, selected)) {
      rotatingEntity = true;
      updateCursor();
      return;
    }

    // 2) Clicking an existing entity selects it (and starts a move drag) —
    //    in ANY tool, so you never stack a new boat on top of one you meant
    //    to grab. Placement only happens on open water.
    const hit = findEntityAt(wp.x, wp.y, world.entities);
    if (hit) {
      world.edit.selectedId = hit.id;
      world.edit.dragging = true;
      world.edit.dragOffset = { x: wp.x - hit.x, y: wp.y - hit.y };
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
    updateCursor();
  }

  function handleEditMouseMove(x, y, width, height) {
    if (!world.edit.dragging && !rotatingEntity) return;
    const wp = screenToWorld(x, y, width, height);
    const e = world.entities.find((en) => en.id === world.edit.selectedId);
    if (!e) return;
    if (rotatingEntity) {
      // The entity turns to face the mouse — bow follows the handle.
      e.heading = Math.atan2(wp.y - e.y, wp.x - e.x);
      world.edit.dirty = true;
    } else {
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
    if (world.edit.dragging || rotatingEntity) {
      world.edit.dragging = false;
      rotatingEntity = false;
      saveWorld(world);
      updateCursor();
    }
  }

  function handleEditWheel(deltaY) {
    if (world.edit.selectedId == null) return;
    const dir = deltaY > 0 ? 1 : -1;
    rotateSelected(dir * ROTATE_STEP);
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

    if (world.edit.mode) {
      handleEditMouseMove(p.x, p.y, p.width, p.height);
      // Placement-ghost anchor: only while idle and actually over the
      // canvas (not the toolbar or other HTML overlays).
      if (!world.edit.dragging && !rotatingEntity && e.target === canvas) {
        world.edit.hover = screenToWorld(p.x, p.y, p.width, p.height);
      } else {
        world.edit.hover = null;
      }
      updateCursor();
      if (world.edit.dragging || rotatingEntity) e.preventDefault();
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
    handleEditWheel(e.deltaY);
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

    if (world.edit.mode) {
      handleEditMouseMove(p.x, p.y, p.width, p.height);
      if (world.edit.dragging || rotatingEntity) e.preventDefault();
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
