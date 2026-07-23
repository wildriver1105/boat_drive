'use client';

import { useEffect, useRef, useState } from 'react';
import { createWorld, saveWorld, clearTrack } from '@/game/world';
import { createInput } from '@/game/input';
import { createRenderer, renderPresetThumb } from '@/game/render';
import { createRenderer3D } from '@/game/render3d';
import { createLoop } from '@/game/loop';
import { ENTITY_PRESETS } from '@/game/entities';
import { buildSampleHarbor } from '@/game/sample-harbor';
import { lineState, adjustMooringLength, removeMooringLine } from '@/game/mooring';
import {
  listSavedMaps,
  saveMapToLibrary,
  loadMapFromLibrary,
  deleteSavedMap,
  downloadMapFile,
  parseMapText,
} from '@/game/map-io';

const KN_TO_MS = 0.514444;

export default function BoatGame() {
  const canvasRef = useRef(null);     // 2D overlay (always on top, handles input)
  const canvas3dRef = useRef(null);   // WebGL layer (3D scene, behind)
  const worldRef = useRef(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showMaps, setShowMaps] = useState(false);
  const [windSpeedKn, setWindSpeedKn] = useState(0);
  const [windFromDeg, setWindFromDeg] = useState(0);
  const [massScale, setMassScale] = useState(1);

  // Editor state — mirrored into world.edit each render.
  const [editMode, setEditMode] = useState(false);
  const [editTool, setEditTool] = useState('select');
  const [selectedEntity, setSelectedEntity] = useState(null);

  // Tracking mode (racing-line recorder).
  const [trackOn, setTrackOn] = useState(false);
  const [trackIntervalS, setTrackIntervalS] = useState(1);

  // Mooring mode + a polled snapshot of the active lines for the panel.
  const [mooringOn, setMooringOn] = useState(false);
  const [mooringLines, setMooringLines] = useState([]);

  // View: '2d' (top-down), 'aerial' (3D chase), 'cockpit' (3D first-person).
  const [viewMode, setViewMode] = useState('2d');
  const viewModeRef = useRef('2d');
  const has3dRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvas3d = canvas3dRef.current;
    if (!canvas) return;

    const world = createWorld();
    worldRef.current = world;
    // Dev-only debug handle (headless testing / console poking).
    if (process.env.NODE_ENV !== 'production') window.__boatWorld = world;

    const renderer = createRenderer(canvas);
    let renderer3d = null;
    try {
      if (canvas3d) renderer3d = createRenderer3D(canvas3d);
    } catch (err) {
      renderer3d = null;
      has3dRef.current = false;
      console.warn('3D view unavailable:', err);
    }
    if (process.env.NODE_ENV !== 'production') window.__boatR3D = renderer3d;

    const fitCanvas = () => {
      const isMobile =
        window.matchMedia?.('(pointer: coarse)').matches ||
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas._dpr = dpr;
      if (renderer3d) renderer3d.resize(w, h);
    };
    fitCanvas();

    const input = createInput({ canvas, world, onSelect: setSelectedEntity });
    // 3D edit picking: route editor mouse points through the aerial camera
    // onto the water plane whenever a 3D view is active.
    input.setWorldPicker((sx, sy) => {
      if (!renderer3d || viewModeRef.current === '2d') return null;
      return renderer3d.pickWater(sx, sy);
    });
    const loop = createLoop({
      world,
      input,
      render: (wld) => {
        const mode = renderer3d ? viewModeRef.current : '2d';
        if (mode === '2d') {
          renderer.draw(wld);
        } else {
          const dpr = canvas._dpr || 1;
          renderer3d.draw(wld, mode, canvas.width / dpr, canvas.height / dpr);
          renderer.drawControlsOnly(wld, renderer3d.project);
        }
      },
    });

    // Pause the loop only when the tab is actually hidden (backgrounded /
    // minimized / screen off). We intentionally do NOT pause on window blur — a
    // visible-but-unfocused window should keep animating, otherwise the canvas
    // looks frozen whenever another window is in front.
    const syncLoopRunning = () => {
      if (document.hidden) loop.stop();
      else loop.start();
    };

    window.addEventListener('resize', fitCanvas);
    document.addEventListener('visibilitychange', syncLoopRunning);
    loop.start();

    return () => {
      loop.stop();
      input.destroy();
      if (renderer3d) renderer3d.dispose();
      window.removeEventListener('resize', fitCanvas);
      document.removeEventListener('visibilitychange', syncLoopRunning);
      worldRef.current = null;
    };
  }, []);

  // Mirror view mode into the loop and toggle the WebGL canvas visibility.
  useEffect(() => {
    viewModeRef.current = viewMode;
    const c3 = canvas3dRef.current;
    if (c3) c3.style.display = viewMode === '2d' ? 'none' : 'block';
  }, [viewMode]);

  // Editing works in the 2D map AND the 3D aerial view (raycast picking).
  // Only the cockpit is drive-only.
  useEffect(() => {
    if (editMode && viewMode === 'cockpit') setViewMode('aerial');
  }, [editMode, viewMode]);

  // "V" cycles 2D → Aerial → Cockpit (ignored while editing or typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'v' && e.key !== 'V') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey || editMode || !has3dRef.current) return;
      setViewMode((m) => (m === '2d' ? 'aerial' : m === 'aerial' ? 'cockpit' : '2d'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode]);

  // Bridge React settings state → world.wind.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.wind.speed = windSpeedKn * KN_TO_MS;
    world.wind.fromBearing = (windFromDeg * Math.PI) / 180;
  }, [windSpeedKn, windFromDeg]);

  // Bridge mass / sensitivity → world.boat.massScale.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.boat.massScale = massScale;
  }, [massScale]);

  // Bridge tracking state → world.track.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.track.on = trackOn;
  }, [trackOn]);
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.track.intervalS = trackIntervalS;
  }, [trackIntervalS]);

  // Mooring mode → world.mooring.mode. Enabling forces the top-down view
  // (you aim at cleats there). Entering the editor disables mooring.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.mooring.mode = mooringOn;
    if (mooringOn) setViewMode('2d');
  }, [mooringOn]);
  useEffect(() => {
    if (editMode) setMooringOn(false);
  }, [editMode]);

  // Poll the live line list while mooring is on (lines are mutated outside React).
  useEffect(() => {
    if (!mooringOn) {
      setMooringLines([]);
      return;
    }
    const tick = () => {
      const world = worldRef.current;
      if (!world) return;
      setMooringLines(
        world.mooring.lines.map((l) => {
          const st = lineState(world, l);
          return { id: l.id, cleatId: l.cleatId, restLength: l.restLength, dist: st.dist, taut: st.taut };
        })
      );
    };
    tick();
    const h = setInterval(tick, 150);
    return () => clearInterval(h);
  }, [mooringOn]);

  // Bridge React editor state → world.edit. Snap camera back to the boat
  // when leaving edit mode; freeze it where it is when entering.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.edit.mode = editMode;
    if (!editMode) {
      world.edit.selectedId = null;
      world.edit.dragging = false;
      world.camera.x = world.boat.x;
      world.camera.y = world.boat.y;
      // Make sure any in-flight work persists.
      saveWorld(world);
    } else {
      // When entering edit mode, also snap throttle to neutral so the boat
      // isn't sitting with a held command waiting to resume.
      world.boat.throttleTarget = 0;
      world.boat.rudderTarget = 0;
    }
  }, [editMode]);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.edit.tool = editTool;
  }, [editTool]);

  // Editor actions on the currently-selected entity (driven by toolbar
  // buttons — no keyboard focus required).
  function rotateSelectedBy(rad) {
    const world = worldRef.current;
    if (!world || world.edit.selectedId == null) return;
    const e = world.entities.find((en) => en.id === world.edit.selectedId);
    if (!e) return;
    e.heading += rad;
    if (e.heading > Math.PI) e.heading -= 2 * Math.PI;
    else if (e.heading <= -Math.PI) e.heading += 2 * Math.PI;
    saveWorld(world);
  }
  function deleteSelected() {
    const world = worldRef.current;
    if (!world || world.edit.selectedId == null) return;
    const idx = world.entities.findIndex((en) => en.id === world.edit.selectedId);
    if (idx >= 0) {
      world.entities.splice(idx, 1);
      world.edit.selectedId = null;
      setSelectedEntity(null);
      saveWorld(world);
    }
  }

  // Replace the whole map with a fresh set of entities (shared by the sample
  // harbor and by map load / import). `confirmMsg` guards against clobbering a
  // non-empty map; pass null to skip the prompt.
  function applyEntities(entities, confirmMsg) {
    const world = worldRef.current;
    if (!world) return false;
    if (confirmMsg && world.entities.length > 0) {
      // eslint-disable-next-line no-alert
      if (!window.confirm(confirmMsg)) return false;
    }
    world.entities.length = 0;
    world.entities.push(...entities);
    world.edit.selectedId = null;
    setSelectedEntity(null);
    world.camera.x = 0;
    world.camera.y = 0;
    saveWorld(world);
    return true;
  }

  // Replace the map with the bundled sample training harbor.
  function loadSampleHarbor() {
    if (applyEntities(buildSampleHarbor(), 'Replace the current map with the sample harbor?')) {
      const world = worldRef.current;
      if (world) world.camera.y = -20; // park over the harbour entrance
    }
  }

  // ---- Map library / file I/O ----
  const [mapList, setMapList] = useState([]);
  const [mapName, setMapName] = useState('');
  const [mapError, setMapError] = useState('');
  const fileInputRef = useRef(null);

  function refreshMapList() {
    setMapList(listSavedMaps());
  }
  // Reload the slot list whenever the manager opens.
  useEffect(() => {
    if (showMaps) {
      refreshMapList();
      setMapError('');
    }
  }, [showMaps]);

  function handleSaveMap() {
    const world = worldRef.current;
    if (!world) return;
    const name = (mapName || '').trim() || `Map ${new Date().toLocaleString()}`;
    saveMapToLibrary(world, name, new Date().toISOString());
    setMapName('');
    refreshMapList();
  }
  function handleLoadMap(id) {
    const entities = loadMapFromLibrary(id);
    if (!entities) return;
    if (applyEntities(entities, 'Replace the current map with this saved map?')) {
      setShowMaps(false);
    }
  }
  function handleDeleteMap(id) {
    deleteSavedMap(id);
    refreshMapList();
  }
  function handleExportMap() {
    const world = worldRef.current;
    if (!world) return;
    const base = (mapName || 'harbor-map').trim().replace(/[^\w.-]+/g, '_') || 'harbor-map';
    downloadMapFile(world, `${base}.json`);
  }
  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const entities = parseMapText(String(reader.result));
        if (applyEntities(entities, 'Replace the current map with the imported file?')) {
          setMapError('');
          setShowMaps(false);
        }
      } catch (err) {
        setMapError('Could not read that file: ' + (err && err.message ? err.message : 'invalid JSON'));
      }
    };
    reader.onerror = () => setMapError('Could not read that file.');
    reader.readAsText(file);
  }

  // ESC closes the modals.
  useEffect(() => {
    if (!showSettings && !showMaps) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowMaps(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings, showMaps]);

  // Global "M" (map) toggles edit mode — "E" is taken by the bow thruster.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      setEditMode((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <canvas ref={canvas3dRef} className="layer-3d" style={{ display: 'none' }} aria-hidden="true" />
      <canvas ref={canvasRef} className="layer-2d" tabIndex={0} aria-label="Boat drive game" />

      <ViewToggle mode={viewMode} onMode={setViewMode} cockpitDisabled={editMode} />

      {!editMode && (
        <>
          <button
            type="button"
            className={`hud-btn moor-btn ${mooringOn ? 'on' : ''}`}
            onClick={() => setMooringOn((v) => !v)}
            aria-label="Toggle mooring mode"
            title="Mooring lines — drag from a cleat to a dock/bollard"
          >
            ⚓
          </button>
          <button
            type="button"
            className={`hud-btn track-btn ${trackOn ? 'rec' : ''}`}
            onClick={() => setTrackOn((v) => !v)}
            aria-label="Toggle tracking mode"
            title="Tracking mode — record the racing line"
          >
            ◉
          </button>
          <button
            type="button"
            className="hud-btn maps-btn"
            onClick={() => setShowMaps(true)}
            aria-label="Open map manager"
            title="Maps — save / load / export"
          >
            🗺
          </button>
          <button
            type="button"
            className="hud-btn edit-btn"
            onClick={() => setEditMode(true)}
            aria-label="Enter edit mode"
            title="Edit map (M)"
          >
            ✎
          </button>
          <button
            type="button"
            className="hud-btn settings-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Open settings"
            title="Settings"
          >
            ⚙
          </button>
        </>
      )}

      {!editMode && trackOn && (
        <div className="track-panel">
          <div className="track-panel-head">
            <span className="track-rec">● REC</span>
            <span className="track-title">TRACKING</span>
          </div>
          <label className="track-row" htmlFor="track-interval">
            Snapshot every
            <span className="track-val">{trackIntervalS.toFixed(2)}s</span>
          </label>
          <input
            id="track-interval"
            type="range"
            min="0.25"
            max="5"
            step="0.25"
            value={trackIntervalS}
            onChange={(e) => setTrackIntervalS(Number(e.target.value))}
          />
          <button
            type="button"
            className="track-clear"
            onClick={() => {
              const w = worldRef.current;
              if (w) clearTrack(w);
            }}
          >
            Clear trail
          </button>
        </div>
      )}

      {!editMode && mooringOn && (
        <div className="moor-panel">
          <div className="moor-head">
            <span className="moor-title">⚓ MOORING LINES</span>
          </div>
          <div className="moor-hint">
            Drag from a cyan cleat on the boat to a dock cleat / bollard.
          </div>
          {mooringLines.length === 0 ? (
            <div className="moor-empty">No lines made fast.</div>
          ) : (
            mooringLines.map((l) => (
              <div className={`moor-row ${l.taut ? 'taut' : ''}`} key={l.id}>
                <span className="moor-name">{cleatName(l.cleatId)}</span>
                <span className="moor-len">{l.restLength.toFixed(1)}m</span>
                <button
                  type="button"
                  title="Shorten (haul in)"
                  onClick={() => {
                    const w = worldRef.current;
                    if (w) adjustMooringLength(w, l.id, -0.5);
                  }}
                >
                  −
                </button>
                <button
                  type="button"
                  title="Lengthen (pay out)"
                  onClick={() => {
                    const w = worldRef.current;
                    if (w) adjustMooringLength(w, l.id, 0.5);
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  className="moor-cast"
                  title="Cast off"
                  onClick={() => {
                    const w = worldRef.current;
                    if (w) removeMooringLine(w, l.id);
                  }}
                >
                  Cast off
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {editMode && (
        <EditorToolbar
          tool={editTool}
          onTool={setEditTool}
          selected={selectedEntity}
          onRotate={rotateSelectedBy}
          onDelete={deleteSelected}
          onLoadSample={loadSampleHarbor}
          onOpenMaps={() => setShowMaps(true)}
          onExit={() => setEditMode(false)}
          onClearAll={() => {
            const world = worldRef.current;
            if (!world) return;
            if (world.entities.length === 0) return;
            // eslint-disable-next-line no-alert
            if (window.confirm(`Remove all ${world.entities.length} placed items?`)) {
              world.entities.length = 0;
              world.edit.selectedId = null;
              saveWorld(world);
            }
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          windSpeedKn={windSpeedKn}
          windFromDeg={windFromDeg}
          massScale={massScale}
          onWindSpeedKn={setWindSpeedKn}
          onWindFromDeg={setWindFromDeg}
          onMassScale={setMassScale}
          onReset={() => {
            setWindSpeedKn(0);
            setWindFromDeg(0);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showMaps && (
        <MapsModal
          maps={mapList}
          name={mapName}
          error={mapError}
          entityCount={worldRef.current ? worldRef.current.entities.length : 0}
          onName={setMapName}
          onSave={handleSaveMap}
          onLoad={handleLoadMap}
          onDelete={handleDeleteMap}
          onExport={handleExportMap}
          onImport={() => fileInputRef.current && fileInputRef.current.click()}
          onClose={() => setShowMaps(false)}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </>
  );
}

function MapsModal({
  maps,
  name,
  error,
  entityCount,
  onName,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImport,
  onClose,
}) {
  const fmtDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso;
    }
  };
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="maps-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="maps-title">Maps</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="setting-group">
            <header className="group-header">
              <span className="group-title">Current map</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {entityCount} item{entityCount === 1 ? '' : 's'}
              </span>
            </header>
            <div className="maps-save-row">
              <input
                type="text"
                className="maps-name"
                placeholder="Map name…"
                value={name}
                onChange={(e) => onName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSave();
                }}
              />
              <button type="button" className="tool-btn primary" onClick={onSave}>
                Save
              </button>
            </div>
            <div className="maps-io-row">
              <button type="button" className="tool-btn" onClick={onExport} title="Download the current map as a .json file">
                ⬇ Export file
              </button>
              <button type="button" className="tool-btn" onClick={onImport} title="Load a map from a .json file on this device">
                ⬆ Import file
              </button>
            </div>
            <p className="maps-note">
              Coordinates are Cartesian metres — origin (0, 0) is the boat’s start point,
              +x east, +y north.
            </p>
            {error ? <p className="maps-error">{error}</p> : null}
          </section>

          <section className="setting-group">
            <header className="group-header">
              <span className="group-title">Saved on this device</span>
            </header>
            {maps.length === 0 ? (
              <div className="maps-empty">No saved maps yet.</div>
            ) : (
              <ul className="maps-list">
                {maps.map((m) => (
                  <li className="maps-item" key={m.id}>
                    <div className="maps-item-info">
                      <span className="maps-item-name">{m.name}</span>
                      <span className="maps-item-meta">
                        {m.count} item{m.count === 1 ? '' : 's'} · {fmtDate(m.savedAt)}
                      </span>
                    </div>
                    <button type="button" className="tool-btn" onClick={() => onLoad(m.id)}>
                      Load
                    </button>
                    <button
                      type="button"
                      className="tool-btn danger"
                      onClick={() => onDelete(m.id)}
                      aria-label={`Delete ${m.name}`}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

function ViewToggle({ mode, onMode, cockpitDisabled }) {
  const opts = [
    { id: '2d', label: '2D Map' },
    { id: 'aerial', label: '3D Aerial' },
    { id: 'cockpit', label: 'Cockpit' },
  ];
  return (
    <div className={`view-toggle ${cockpitDisabled ? 'edit' : ''}`} role="group" aria-label="View mode">
      {opts.map((o) => {
        const disabled = cockpitDisabled && o.id === 'cockpit';
        return (
          <button
            key={o.id}
            type="button"
            className={`view-btn ${mode === o.id ? 'active' : ''}`}
            onClick={() => onMode(o.id)}
            disabled={disabled}
            title={disabled ? 'Cockpit is drive-only' : o.label + ' (V to cycle)'}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const PALETTE_TABS = [
  { id: 'dock', label: 'Docks', icon: '⚓' },
  { id: 'boat', label: 'Boats', icon: '⛵' },
  { id: 'buoy', label: 'Marks', icon: '🟠' },
  { id: 'terrain', label: 'Terrain', icon: '⛰' },
];

function paletteItems(tabId) {
  if (tabId === 'dock') {
    return ENTITY_PRESETS.filter((p) => p.category === 'dock' || p.category === 'bollard');
  }
  return ENTITY_PRESETS.filter((p) => p.category === tabId);
}

// Game-style asset inventory: category tabs + a scrollable grid of cards,
// each with a live-rendered preview of the actual map art.
function AssetPalette({ tool, onTool }) {
  const [tab, setTab] = useState('dock');
  const [thumbs, setThumbs] = useState(null);

  // Thumbnails are generated once, client-side, from the real 2D renderers.
  useEffect(() => {
    const t = {};
    for (const p of ENTITY_PRESETS) t[p.id] = renderPresetThumb(p, 96);
    setThumbs(t);
  }, []);

  const items = paletteItems(tab);
  return (
    <div className="asset-palette" role="listbox" aria-label="Asset inventory">
      <div className="palette-tabs" role="tablist">
        {PALETTE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`palette-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="palette-tab-icon" aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="palette-grid">
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`asset-card ${tool === p.id ? 'active' : ''}`}
            onClick={() => onTool(tool === p.id ? 'select' : p.id)}
            title={
              p.height
                ? `${p.label} — ${p.length}m × ${p.width}m, ${p.height}m high`
                : `${p.label} — ${p.length}m × ${p.width}m`
            }
          >
            <span className="asset-thumb">
              {thumbs && thumbs[p.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[p.id]} alt="" draggable="false" />
              ) : null}
            </span>
            <span className="asset-name">{p.label}</span>
          </button>
        ))}
      </div>
      <div className="palette-hint">
        {tool === 'select'
          ? 'Pick an asset, then click open water'
          : ENTITY_PRESETS.find((p) => p.id === tool)?.category === 'terrain'
            ? 'Drag across open water to size & aim it'
            : 'Click open water to place — click the card again to stop'}
      </div>
    </div>
  );
}

function EditorToolbar({ tool, onTool, selected, onRotate, onDelete, onLoadSample, onOpenMaps, onExit, onClearAll }) {
  const sel = !!selected;
  return (
    <>
    <div className="editor-bar" role="toolbar" aria-label="Map editor">
      <div className="editor-bar-row">
        <span className="editor-mode-tag">EDIT</span>
        <button
          type="button"
          className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
          onClick={() => onTool('select')}
          title="Select / move"
        >
          <span aria-hidden="true">↖</span> Select
        </button>
        <span className="tool-spacer" />
        <button type="button" className="tool-btn" onClick={onOpenMaps} title="Save / load / export the map">
          🗺 Maps
        </button>
        <button type="button" className="tool-btn" onClick={onLoadSample} title="Load the bundled sample training harbor (replaces the map)">
          ⚓ Sample harbor
        </button>
        <button type="button" className="tool-btn danger" onClick={onClearAll} title="Remove all">
          Clear all
        </button>
        <button type="button" className="tool-btn primary" onClick={onExit} title="Exit edit mode (M)">
          Done
        </button>
      </div>
    </div>

    <AssetPalette tool={tool} onTool={onTool} />

    {/* Selection actions — appear under the header only when an item is
        selected, so the header stays clean otherwise. */}
    {sel && (
      <div className="editor-selbar" role="toolbar" aria-label="Selected item actions">
        <span className="selbar-label">{prettyName(selected.presetId)}</span>
        <span className="tool-divider" />
        <button type="button" className="tool-btn" onClick={() => onRotate(-Math.PI / 2)} title="Rotate 90° counter-clockwise">
          ⟲ 90°
        </button>
        <button type="button" className="tool-btn" onClick={() => onRotate(Math.PI / 2)} title="Rotate 90° clockwise">
          ⟳ 90°
        </button>
        <button type="button" className="tool-btn" onClick={() => onRotate(Math.PI)} title="Flip 180°">
          ⤢ 180°
        </button>
        <button type="button" className="tool-btn" onClick={() => onRotate(-Math.PI / 12)} title="Nudge 15° counter-clockwise">
          −15°
        </button>
        <button type="button" className="tool-btn" onClick={() => onRotate(Math.PI / 12)} title="Nudge 15° clockwise">
          +15°
        </button>
        <span className="tool-divider" />
        <button type="button" className="tool-btn danger" onClick={onDelete} title="Delete selected (or press Delete)">
          🗑 Delete
        </button>
      </div>
    )}
    </>
  );
}

function prettyName(presetId) {
  const p = ENTITY_PRESETS.find((q) => q.id === presetId);
  return p ? p.label : 'Selected';
}

function cleatName(id) {
  return (
    {
      'bow-p': 'Bow (port)',
      'bow-s': 'Bow (stbd)',
      'mid-p': 'Midships (port)',
      'mid-s': 'Midships (stbd)',
      'stern-p': 'Stern (port)',
      'stern-s': 'Stern (stbd)',
    }[id] || id
  );
}

function SettingsModal({
  windSpeedKn,
  windFromDeg,
  massScale,
  onWindSpeedKn,
  onWindFromDeg,
  onMassScale,
  onReset,
  onClose,
}) {
  const massLabel =
    massScale < 0.85
      ? 'light · twitchy'
      : massScale <= 1.6
        ? 'standard'
        : massScale <= 4
          ? 'heavy · slow to spool'
          : 'displacement · auxiliary power';
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

          <section className="setting-group">
            <header className="group-header">
              <span className="group-title">Boat handling</span>
              <button type="button" className="link-btn" onClick={() => onMassScale(1)}>
                Reset
              </button>
            </header>
            <div className="row">
              <label htmlFor="mass-scale">
                Mass <span className="muted">(heavier = less sensitive)</span>
                <span className="value">{massScale.toFixed(2)}× · {massLabel}</span>
              </label>
              <input
                id="mass-scale"
                type="range"
                min="0.5"
                max="8"
                step="0.1"
                value={massScale}
                onChange={(e) => onMassScale(Number(e.target.value))}
              />
              <div className="ticks">
                <span>light</span>
                <span>standard</span>
                <span>heavy</span>
                <span>displacement</span>
              </div>
            </div>
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
