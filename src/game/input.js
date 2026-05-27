// Tracks raw key state on window plus mouse/touch dragging on the throttle
// handle. The physics module reads `getKeys()` each step.
//
// Throttle can be controlled two ways:
//   • Keyboard W/S — sticky ramping (handled by physics)
//   • Mouse drag   — directly sets boat.throttleTarget (handled here)
// While dragging with the mouse, keyboard throttle adjustment is suppressed
// (mouseDraggingThrottle flag) so the two inputs don't fight each other.

import { hitTestThrottle, throttleLayout, yToThrottleValue } from './ui-layout.js';

export function createInput({ canvas, world }) {
  const keys = new Set();
  let draggingThrottle = false;
  let hoverThrottle = false;
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

  // ---------- Mouse / touch on throttle handle ----------

  function pointFromMouse(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      layout: throttleLayout(rect.width, rect.height),
    };
  }

  function pointFromTouch(touch) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
      layout: throttleLayout(rect.width, rect.height),
    };
  }

  function updateCursor() {
    const next = draggingThrottle ? 'grabbing' : hoverThrottle ? 'grab' : 'crosshair';
    if (next !== lastCursor) {
      canvas.style.cursor = next;
      lastCursor = next;
    }
  }

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const { x, y, layout } = pointFromMouse(e);
    if (hitTestThrottle(x, y, layout)) {
      draggingThrottle = true;
      world.boat.throttleTarget = yToThrottleValue(y, layout);
      updateCursor();
      e.preventDefault();
    }
  };
  const onMouseMove = (e) => {
    const { x, y, layout } = pointFromMouse(e);
    hoverThrottle = hitTestThrottle(x, y, layout);
    if (draggingThrottle) {
      world.boat.throttleTarget = yToThrottleValue(y, layout);
      e.preventDefault();
    }
    updateCursor();
  };
  const onMouseUp = (e) => {
    if (draggingThrottle) {
      draggingThrottle = false;
      updateCursor();
      e.preventDefault();
    }
  };
  const onMouseLeave = () => {
    hoverThrottle = false;
    updateCursor();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);

  const onTouchStart = (e) => {
    if (e.touches.length === 0) return;
    const { x, y, layout } = pointFromTouch(e.touches[0]);
    if (hitTestThrottle(x, y, layout)) {
      draggingThrottle = true;
      world.boat.throttleTarget = yToThrottleValue(y, layout);
      e.preventDefault();
    }
  };
  const onTouchMove = (e) => {
    if (!draggingThrottle || e.touches.length === 0) return;
    const { y, layout } = pointFromTouch(e.touches[0]);
    world.boat.throttleTarget = yToThrottleValue(y, layout);
    e.preventDefault();
  };
  const onTouchEnd = () => {
    draggingThrottle = false;
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
