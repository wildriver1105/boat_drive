// Tracks raw key state on window, and exposes target values for throttle/rudder.
// The physics module is responsible for smoothing these targets over time.

export function createInput() {
  const keys = new Set();

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

  return {
    getTargets() {
      let throttle = 0;
      let rudder = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) rudder -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) rudder += 1;
      if (keys.has('Space')) {
        throttle = 0;
        rudder = 0;
      }
      return { throttle, rudder };
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
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
