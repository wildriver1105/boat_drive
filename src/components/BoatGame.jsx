'use client';

import { useEffect, useRef } from 'react';
import { createWorld } from '@/game/world';
import { createInput } from '@/game/input';
import { createRenderer } from '@/game/render';
import { createLoop } from '@/game/loop';

export default function BoatGame() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fitCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas._dpr = dpr;
    };
    fitCanvas();

    const world = createWorld();
    const input = createInput();
    const renderer = createRenderer(canvas);
    const loop = createLoop({
      world,
      input,
      render: (w) => renderer.draw(w),
    });

    window.addEventListener('resize', fitCanvas);
    loop.start();

    return () => {
      loop.stop();
      input.destroy();
      window.removeEventListener('resize', fitCanvas);
    };
  }, []);

  return <canvas ref={canvasRef} tabIndex={0} aria-label="Boat drive game" />;
}
