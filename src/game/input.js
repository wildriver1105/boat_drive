// Tracks raw key state on window plus mouse/touch dragging on the throttle
// handle AND the helm wheel.
//
// Both throttle and rudder are sticky:
//   • Throttle: W/S ramp the target; mouse drag on the lever sets it directly.
//   • Rudder  : A/D ramp the target; mouse drag rotates the helm wheel,
//               applying its angular delta to the rudder target.
// While a control is being mouse-dragged, the matching keys are suppressed
// (mouseDraggingThrottle / mouseDraggingHelm flags).

import {
  hitTestThrottle,
  throttleLayout,
  yToThrottleValue,
  helmLayout,
  hitTestHelm,
} from './ui-layout.js';
import { HELM_MAX_ANGLE } from './constants.js';

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
      layoutT: throttleLayout(rect.width, rect.height),
      layoutH: helmLayout(rect.width, rect.height),
    };
  }

  function updateCursor() {
    let next;
    if (draggingThrottle || draggingHelm) next = 'grabbing';
    else if (hoverThrottle || hoverHelm) next = 'grab';
    else next = 'crosshair';
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
    // Wrap dAngle to the nearest representative in (-π, π] so a small motion
    // across the discontinuity isn't read as nearly a full rotation.
    while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
    while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    prevHelmMouseAngle = curAngle;
    const rudderDelta = dAngle / HELM_MAX_ANGLE;
    world.boat.rudderTarget = clamp(world.boat.rudderTarget + rudderDelta, -1, 1);
  }

  // ---------- Mouse ----------

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const { x, y, layoutT, layoutH } = pointFromClient(e.clientX, e.clientY);
    if (hitTestThrottle(x, y, layoutT)) {
      draggingThrottle = true;
      world.boat.throttleTarget = yToThrottleValue(y, layoutT);
      updateCursor();
      e.preventDefault();
    } else if (hitTestHelm(x, y, layoutH)) {
      draggingHelm = true;
      prevHelmMouseAngle = Math.atan2(y - layoutH.cy, x - layoutH.cx);
      updateCursor();
      e.preventDefault();
    }
  };
  const onMouseMove = (e) => {
    const { x, y, layoutT, layoutH } = pointFromClient(e.clientX, e.clientY);
    hoverThrottle = !draggingHelm && hitTestThrottle(x, y, layoutT);
    hoverHelm = !draggingThrottle && hitTestHelm(x, y, layoutH);
    if (draggingThrottle) {
      world.boat.throttleTarget = yToThrottleValue(y, layoutT);
      e.preventDefault();
    } else if (draggingHelm) {
      applyHelmDrag(x, y, layoutH);
      e.preventDefault();
    }
    updateCursor();
  };
  const onMouseUp = (e) => {
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

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);

  // ---------- Touch ----------

  const onTouchStart = (e) => {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    const { x, y, layoutT, layoutH } = pointFromClient(t.clientX, t.clientY);
    if (hitTestThrottle(x, y, layoutT)) {
      draggingThrottle = true;
      world.boat.throttleTarget = yToThrottleValue(y, layoutT);
      e.preventDefault();
    } else if (hitTestHelm(x, y, layoutH)) {
      draggingHelm = true;
      prevHelmMouseAngle = Math.atan2(y - layoutH.cy, x - layoutH.cx);
      e.preventDefault();
    }
  };
  const onTouchMove = (e) => {
    if ((!draggingThrottle && !draggingHelm) || e.touches.length === 0) return;
    const t = e.touches[0];
    const { x, y, layoutT, layoutH } = pointFromClient(t.clientX, t.clientY);
    if (draggingThrottle) {
      world.boat.throttleTarget = yToThrottleValue(y, layoutT);
    } else if (draggingHelm) {
      applyHelmDrag(x, y, layoutH);
    }
    e.preventDefault();
  };
  const onTouchEnd = () => {
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
