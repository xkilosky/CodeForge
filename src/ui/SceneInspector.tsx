/**
 * The property inspector and the builder toolbar.
 *
 * Every numeric field is a text input parsed on change rather than a
 * `<input type="number">`. A number input on iOS raises a keyboard with no
 * minus sign and no way to clear the field without entering an invalid state,
 * and this inspector is the only way to position an object precisely on a
 * phone.
 *
 * The field shows what the scene holds. A partially typed value (`-`, ``,
 * `12.`) is kept in local state so typing is not fought by re-renders, and only
 * pushed to the scene once it parses into a finite number.
 */

import { useEffect, useState } from 'react';
import type { Entity, Scene } from '../core/scene';
import { PALETTE } from '../core/scene';

interface InspectorProps {
  scene: Scene;
  selected: Entity | null;
  isPlayer: boolean;
  onUpdate: (patch: Partial<Omit<Entity, 'id'>>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetPlayer: () => void;
  onClose: () => void;
  onWorld: (patch: Partial<Scene['world']>) => void;
}

export function SceneInspector({
  scene,
  selected,
  isPlayer,
  onUpdate,
  onDelete,
  onDuplicate,
  onSetPlayer,
  onClose,
  onWorld,
}: InspectorProps) {
  if (!selected) {
    return (
      <div className="inspector">
        <div className="inspector-head">
          <span>Stage</span>
        </div>
        <div className="inspector-body">
          <NumberRow
            label="Width"
            value={scene.world.width}
            onChange={(width) => onWorld({ width: Math.max(120, width) })}
          />
          <NumberRow
            label="Height"
            value={scene.world.height}
            onChange={(height) => onWorld({ height: Math.max(120, height) })}
          />
          <NumberRow
            label="Gravity"
            value={scene.world.gravity}
            onChange={(gravity) => onWorld({ gravity })}
          />
          <p className="muted inspector-hint">
            Select an object on the stage to edit it. Drag to move; drag a corner to resize.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="inspector-head">
        <span>Object</span>
        <button className="inspector-close" onClick={onClose} aria-label="Deselect">
          ×
        </button>
      </div>
      <div className="inspector-body">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="field-input"
            value={selected.name}
            spellCheck={false}
            onChange={(event) => onUpdate({ name: event.target.value })}
          />
        </label>

        <div className="field-grid">
          <NumberRow label="X" value={selected.x} onChange={(x) => onUpdate({ x })} />
          <NumberRow label="Y" value={selected.y} onChange={(y) => onUpdate({ y })} />
          <NumberRow
            label="W"
            value={selected.w}
            onChange={(w) => onUpdate({ w })}
          />
          <NumberRow
            label="H"
            value={selected.h}
            onChange={(h) => onUpdate({ h })}
          />
        </div>

        <div className="field">
          <span className="field-label">Colour</span>
          <div className="swatches">
            {PALETTE.map((color) => (
              <button
                key={color}
                className={`swatch${selected.color === color ? ' active' : ''}`}
                style={{ background: color }}
                onClick={() => onUpdate({ color })}
                aria-label={`Colour ${color}`}
                aria-pressed={selected.color === color}
              />
            ))}
          </div>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={selected.solid}
            onChange={(event) => onUpdate({ solid: event.target.checked })}
          />
          <span>
            Solid
            <span className="muted"> — blocks the player and never moves</span>
          </span>
        </label>

        <div className="inspector-actions">
          <button className="btn" onClick={onSetPlayer} disabled={isPlayer}>
            {isPlayer ? 'Is the player' : 'Make player'}
          </button>
          <button className="btn" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="btn danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  // Follow the scene when it changes underneath us (a drag, a duplicate, an
  // undo), but never while the user is mid-edit on this field.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <label className="field field-inline">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        value={draft}
        inputMode="numeric"
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = Number(next);
          if (next.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}

interface ToolbarProps {
  onAdd: (kind: 'box' | 'circle') => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onTogglePlay: () => void;
  playing: boolean;
  onRestart: () => void;
}

/**
 * The builder toolbar.
 *
 * Play/Restart live here rather than only in the top bar because the builder is
 * where the user is looking: pressing Run in the header and then hunting for
 * the preview pane is the kind of thing that makes a builder feel unfinished.
 */
export function BuilderToolbar({
  onAdd,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onTogglePlay,
  playing,
  onRestart,
}: ToolbarProps) {
  return (
    <div className="builder-toolbar">
      <div className="builder-group">
        <button className="btn" onClick={() => onAdd('box')} title="Add a box">
          + Box
        </button>
        <button className="btn" onClick={() => onAdd('circle')} title="Add a circle">
          + Circle
        </button>
      </div>
      <div className="builder-group">
        <button className="btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
      </div>
      <div className="builder-group builder-transport">
        <button className={`btn${playing ? ' primary' : ''}`} onClick={onTogglePlay}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <button className="btn" onClick={onRestart} title="Restart from the beginning">
          ↺ Restart
        </button>
      </div>
    </div>
  );
}
