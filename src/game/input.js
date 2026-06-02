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
} from './ui-layout.js';
import { HELM_MAX_ANGLE, PX_PER_M } from './constants.js';
import { createEntity, findEntityAt } from './entities.js';
import { saveWorld } from './world.js';

const ROTATE_STEP = Math.PI / 12; // 15° per key press / wheel notch

export function createInput({ canvas, world }) {
  const keys = new Set();
  let draggingThrottle = false;
  let draggingHelm = false;
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

  function handleEditMouseDown(x, y, width, height) {
    const wp = screenToWorld(x, y, width, height);
    const tool = world.edit.tool;
    if (tool === 'select') {
      const hit = findEntityAt(wp.x, wp.y, world.entities);
      if (hit) {
        world.edit.selectedId = hit.id;
        world.edit.dragging = true;
        world.edit.dragOffset = { x: wp.x - hit.x, y: wp.y - hit.y };
      } else {
        world.edit.selectedId = null;
        world.edit.dragging = false;
      }
    } else {
      const entity = createEntity(tool, wp.x, wp.y);
      if (entity) {
        world.entities.push(entity);
        world.edit.selectedId = entity.id;
        world.edit.dragging = true;
        world.edit.dragOffset = { x: 0, y: 0 };
        world.edit.dirty = true;
      }
    }
    updateCursor();
  }

  function handleEditMouseMove(x, y, width, height) {
    if (!world.edit.dragging) return;
    const wp = screenToWorld(x, y, width, height);
    const e = world.entities.find((en) => en.id === world.edit.selectedId);
    if (e) {
      e.x = wp.x - world.edit.dragOffset.x;
      e.y = wp.y - world.edit.dragOffset.y;
      world.edit.dirty = true;
    }
  }

  function handleEditMouseUp() {
    if (world.edit.dragging) {
      world.edit.dragging = false;
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
    }
  };
  const onMouseMove = (e) => {
    const p = pointFromClient(e.clientX, e.clientY);

    if (world.edit.mode) {
      handleEditMouseMove(p.x, p.y, p.width, p.height);
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
    if (world.edit.mode) {
      handleEditMouseUp();
      e.preventDefault();
      return;
    }
    if (draggingThrottle || draggingHelm) {
      draggingThrottle = false;
      draggingHelm = false;
      updateCursor();
      e.preventDefault();
    }
  };
  const onMouseLeave = () => {
    hoverThrottle = false;
    hoverHelm = false;
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
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const p = pointFromClient(t.clientX, t.clientY);

    if (world.edit.mode) {
      handleEditMouseMove(p.x, p.y, p.width, p.height);
      if (world.edit.dragging) e.preventDefault();
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
  };
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('touchcancel', onTouchEnd);

  return {
    getKeys() {
      return {
        throttleUp: keys.has('KeyW') || keys.has('ArrowUp'),
        throttleDown: keys.has('KeyS') || keys.has('ArrowDown'),
        rudderLeft: keys.has('KeyA') || keys.has('ArrowLeft'),
        rudderRight: keys.has('KeyD') || keys.has('ArrowRight'),
        neutral: keys.has('Space'),
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
    code === 'ArrowUp' ||
    code === 'ArrowDown' ||
    code === 'ArrowLeft' ||
    code === 'ArrowRight' ||
    code === 'Space'
  );
}
