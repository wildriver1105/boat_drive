'use client';

import { useEffect, useRef, useState } from 'react';
import { createWorld } from '@/game/world';
import { createInput } from '@/game/input';
import { createRenderer } from '@/game/render';
import { createLoop } from '@/game/loop';

const KN_TO_MS = 0.514444;

export default function BoatGame() {
  const canvasRef = useRef(null);
  const worldRef = useRef(null);

  const [showSettings, setShowSettings] = useState(false);
  const [windSpeedKn, setWindSpeedKn] = useState(0);   // knots
  const [windFromDeg, setWindFromDeg] = useState(0);    // compass bearing wind comes FROM

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
    worldRef.current = world;
    const input = createInput({ canvas, world });
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
      worldRef.current = null;
    };
  }, []);

  // Bridge React settings state → mutable world.wind that physics reads each step.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.wind.speed = windSpeedKn * KN_TO_MS;
    world.wind.fromBearing = (windFromDeg * Math.PI) / 180;
  }, [windSpeedKn, windFromDeg]);

  // ESC closes the modal.
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings]);

  return (
    <>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Boat drive game" />
      <button
        type="button"
        className="settings-btn"
        onClick={() => setShowSettings(true)}
        aria-label="Open settings"
        title="Settings"
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {showSettings && (
        <SettingsModal
          windSpeedKn={windSpeedKn}
          windFromDeg={windFromDeg}
          onWindSpeedKn={setWindSpeedKn}
          onWindFromDeg={setWindFromDeg}
          onReset={() => {
            setWindSpeedKn(0);
            setWindFromDeg(0);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}

function SettingsModal({
  windSpeedKn,
  windFromDeg,
  onWindSpeedKn,
  onWindFromDeg,
  onReset,
  onClose,
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="settings-title">Environment</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="setting-group">
            <header className="group-header">
              <span className="group-title">Wind</span>
              <button type="button" className="link-btn" onClick={onReset}>
                Reset to calm
              </button>
            </header>

            <div className="row">
              <label htmlFor="wind-speed">
                Speed
                <span className="value">{windSpeedKn.toFixed(0)} kn</span>
              </label>
              <input
                id="wind-speed"
                type="range"
                min="0"
                max="40"
                step="1"
                value={windSpeedKn}
                onChange={(e) => onWindSpeedKn(Number(e.target.value))}
              />
              <div className="ticks">
                <span>calm</span>
                <span>breeze</span>
                <span>strong</span>
                <span>gale</span>
              </div>
            </div>

            <div className="row">
              <label htmlFor="wind-from">
                Direction <span className="muted">(wind comes from)</span>
                <span className="value">
                  {windFromDeg.toFixed(0).padStart(3, '0')}° {cardinal(windFromDeg)}
                </span>
              </label>
              <input
                id="wind-from"
                type="range"
                min="0"
                max="359"
                step="1"
                value={windFromDeg}
                onChange={(e) => onWindFromDeg(Number(e.target.value))}
              />
              <div className="ticks compass">
                <span>N</span>
                <span>E</span>
                <span>S</span>
                <span>W</span>
                <span>N</span>
              </div>
            </div>

            <WindPreview speedKn={windSpeedKn} fromDeg={windFromDeg} />
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function WindPreview({ speedKn, fromDeg }) {
  // Simple compass diagram showing direction the wind is BLOWING TO.
  const size = 110;
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const bearingTo = ((fromDeg + 180) * Math.PI) / 180;
  const dirX = Math.sin(bearingTo);
  const dirY = -Math.cos(bearingTo);
  const tipX = cx + dirX * r;
  const tipY = cy + dirY * r;
  const tailX = cx - dirX * (r - 6);
  const tailY = cy - dirY * (r - 6);
  const calm = speedKn < 1;
  return (
    <div className="wind-preview">
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={cx} cy={cy} r={r + 4} className="compass-bg" />
        <circle cx={cx} cy={cy} r={r} className="compass-ring" />
        <text x={cx} y={cy - r + 10} textAnchor="middle" className="compass-n">N</text>
        <text x={cx + r - 6} y={cy + 4} textAnchor="end" className="compass-c">E</text>
        <text x={cx} y={cy + r - 2} textAnchor="middle" className="compass-c">S</text>
        <text x={cx - r + 6} y={cy + 4} textAnchor="start" className="compass-c">W</text>
        {!calm && (
          <>
            <line
              x1={tailX}
              y1={tailY}
              x2={tipX}
              y2={tipY}
              className="compass-arrow"
            />
            <polygon
              points={`${tipX},${tipY} ${tipX - dirX * 8 + -dirY * 5},${tipY - dirY * 8 + dirX * 5} ${tipX - dirX * 8 - -dirY * 5},${tipY - dirY * 8 - dirX * 5}`}
              className="compass-arrow"
            />
          </>
        )}
      </svg>
      <div className="wind-preview-meta">
        <div className="big">{calm ? 'Calm' : `${speedKn.toFixed(0)} kn`}</div>
        <div className="muted">
          {calm ? 'no wind force' : `blowing toward ${cardinal((fromDeg + 180) % 360)}`}
        </div>
      </div>
    </div>
  );
}

function cardinal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) / 45) % 8];
}
