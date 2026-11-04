/**
 * The visual stage: drag, resize, select.
 *
 * Drawing happens on a `<canvas>`; hit-testing, dragging and resizing are done
 * in stage units against the scene, not against pixels and not against the DOM.
 * That matters for touch: a `pointermove` on a 3 px handle is unhittable with a
 * thumb, so the grab allowance below is deliberately larger than the handle.
 *
 * Everything here is presentation and direct manipulation. The scene itself is
 * immutable and changes only through the callbacks the parent passes in, so the
 * editor cannot hold a stale copy of what it is editing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entity, Scene } from '../core/scene';
import { MIN_ENTITY_SIZE } from '../core/scene';

interface StageEditorProps {
  scene: Scene;
  selectedId: string | null;
  playerId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  /** Called once when a drag starts, so the parent can open one undo entry. */
  onGestureStart?: () => void;
  /** Called when the drag ends, closing that one undo entry. */
  onGestureEnd?: () => void;
}

type Drag =
  | { kind: 'move'; id: string; grabX: number; grabY: number; startX: number; startY: number }
  | { kind: 'resize'; id: string; startW: number; startH: number; startX: number; startY: number };

/** Screen-space slack around a corner, in CSS pixels. Thumb-sized on purpose. */
const HANDLE_SLOP = 12;

export function StageEditor({
  scene,
  selectedId,
  playerId,
  onSelect,
  onMove,
  onResize,
  onGestureStart,
  onGestureEnd,
}: StageEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<Drag | null>(null);

  // Track the host's box. A ResizeObserver rather than window resize, because
  // the pane changes size when the layout tier changes too.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.observe(host);
    setSize({ width: host.clientWidth, height: host.clientHeight });
    return () => observer.disconnect();
  }, []);

  /** Fit the stage inside the pane, preserving aspect ratio (letterboxed). */
  const scale = Math.min(
    size.width > 0 ? size.width / scene.world.width : 1,
    size.height > 0 ? size.height / scene.world.height : 1,
  );
  const offsetX = (size.width - scene.world.width * scale) / 2;
  const offsetY = (size.height - scene.world.height * scale) / 2;

  const toStage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || scale <= 0) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top - offsetY) / scale,
      };
    },
    [offsetX, offsetY, scale],
  );

  // --- draw --------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Stage background and a light grid, so dragging has a reference.
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, scene.world.width, scene.world.height);
    ctx.strokeStyle = '#161f33';
    ctx.lineWidth = 1 / scale;
    const step = 40;
    for (let x = step; x < scene.world.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scene.world.height);
      ctx.stroke();
    }
    for (let y = step; y < scene.world.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(scene.world.width, y);
      ctx.stroke();
    }

    for (const entity of scene.entities) {
      const selected = entity.id === selectedId;
      ctx.fillStyle = entity.color;
      if (entity.kind === 'circle') {
        ctx.beginPath();
        ctx.ellipse(
          entity.x + entity.w / 2,
          entity.y + entity.h / 2,
          entity.w / 2,
          entity.h / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else {
        ctx.fillRect(entity.x, entity.y, entity.w, entity.h);
      }

      if (entity.solid) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(entity.x + 1, entity.y + 1, entity.w - 2, entity.h - 2);
      }

      if (entity.id === playerId) {
        // A ring, not a fill: the player keeps its colour, and the marker reads
        // on top of any colour in the palette.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3 / scale;
        ctx.strokeRect(entity.x - 3 / scale, entity.y - 3 / scale, entity.w + 6 / scale, entity.h + 6 / scale);
      }

      if (selected) {
        ctx.strokeStyle = '#4dabf7';
        ctx.lineWidth = 2 / scale;
        ctx.setLineDash([6 / scale, 4 / scale]);
        ctx.strokeRect(entity.x, entity.y, entity.w, entity.h);
        ctx.setLineDash([]);
        // Corner handles, one per corner, so a resized box can grow either way.
        const r = 5 / scale;
        ctx.fillStyle = '#4dabf7';
        for (const [hx, hy] of corners(entity)) {
          ctx.beginPath();
          ctx.rect(hx - r, hy - r, r * 2, r * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }, [scene, selectedId, playerId, size, scale, offsetX, offsetY]);

  // --- hit testing -------------------------------------------------------
  const cornerAt = useCallback(
    (entity: Entity, point: { x: number; y: number }) => {
      const slop = HANDLE_SLOP / (scale || 1);
      for (const [cx, cy] of corners(entity)) {
        if (Math.abs(point.x - cx) <= slop && Math.abs(point.y - cy) <= slop) return { cx, cy };
      }
      return null;
    },
    [scale],
  );

  /** Topmost entity under the point; later entities are drawn on top. */
  const entityAt = useCallback(
    (point: { x: number; y: number }): Entity | null => {
      for (let i = scene.entities.length - 1; i >= 0; i--) {
        const entity = scene.entities[i];
        if (
          point.x >= entity.x &&
          point.x <= entity.x + entity.w &&
          point.y >= entity.y &&
          point.y <= entity.y + entity.h
        ) {
          return entity;
        }
      }
      return null;
    },
    [scene.entities],
  );

  // --- pointer handling --------------------------------------------------
  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = toStage(event.clientX, event.clientY);
    const selected = scene.entities.find((entity) => entity.id === selectedId);
    // A corner of the *selected* entity wins over whatever is beneath it, or a
    // small entity could never be grown larger.
    if (selected && cornerAt(selected, point)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      onGestureStart?.();
      dragRef.current = {
        kind: 'resize',
        id: selected.id,
        startW: selected.w,
        startH: selected.h,
        startX: point.x,
        startY: point.y,
      };
      return;
    }

    const hit = entityAt(point);
    onSelect(hit?.id ?? null);
    if (!hit) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onGestureStart?.();
    dragRef.current = {
      kind: 'move',
      id: hit.id,
      grabX: point.x - hit.x,
      grabY: point.y - hit.y,
      startX: hit.x,
      startY: hit.y,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toStage(event.clientX, event.clientY);
    if (drag.kind === 'move') {
      onMove(
        drag.id,
        Math.round(point.x - drag.grabX),
        Math.round(Math.max(0, point.y - drag.grabY)),
      );
    } else {
      // Resize from the bottom-right quadrant of the pointer's travel relative
      // to the fixed top-left corner. Keeps the drag predictable: the corner
      // being dragged follows the finger.
      const w = Math.max(MIN_ENTITY_SIZE, Math.round(drag.startW + (point.x - drag.startX)));
      const h = Math.max(MIN_ENTITY_SIZE, Math.round(drag.startH + (point.y - drag.startY)));
      onResize(drag.id, w, h);
    }
  }

  function endDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Closing the gesture here is what makes the next edit its own undo step.
    // Without it the flag would stay set and every later change would fold into
    // the drag that ended minutes ago.
    onGestureEnd?.();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const empty = scene.entities.length === 0;

  return (
    <div className="stage-editor" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        role="application"
        aria-label={`Stage, ${scene.entities.length} objects`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      {empty ? (
        <div className="stage-empty">
          <p>This stage is empty.</p>
          <p className="muted">Add a box or a circle from the toolbar, then press Run.</p>
        </div>
      ) : null}
    </div>
  );
}

/** The four corners of an entity, in stage units. */
function corners(entity: Entity): [number, number][] {
  return [
    [entity.x, entity.y],
    [entity.x + entity.w, entity.y],
    [entity.x, entity.y + entity.h],
    [entity.x + entity.w, entity.y + entity.h],
  ];
}
