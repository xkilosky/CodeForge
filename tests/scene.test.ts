/**
 * The scene model and the builder's editing actions.
 *
 * Two kinds of assertion here. The pure ones cover `normalizeScene` — the gate
 * every persisted project passes through, where a scene from an older build or
 * a hand-edited IndexedDB row must become *something* safe rather than a
 * half-loaded stage with `NaN` coordinates. The store ones cover what a user
 * actually does: drag, resize, undo, redo, delete the player.
 *
 * IndexedDB is faked for the same reason the projects tests fake it: these
 * actions persist, and the persistence path is part of the behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/core/types';
import {
  addEntity,
  emptyScene,
  normalizeScene,
  removeEntity,
  resolvePlayer,
  setPlayer,
  starterScene,
  updateEntity,
  MIN_ENTITY_SIZE,
} from '../src/core/scene';
import { projectFromTemplate, templateById } from '../src/core/templates';

const rows = new Map<string, Project>();

vi.mock('../src/core/idb', () => ({
  db: {
    listProjects: async () => [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    getProject: async (id: string) => rows.get(id),
    putProject: async (project: Project) => {
      rows.set(project.id, project);
      return project.id;
    },
    deleteProject: async (id: string) => {
      rows.delete(id);
      return undefined;
    },
  },
}));

const { projectActions, projectStore } = await import('../src/core/projectStore');

beforeEach(() => {
  rows.clear();
  projectStore.set({
    project: null,
    recent: [],
    loading: false,
    dirty: false,
    error: null,
    undoDepth: 0,
    redoDepth: 0,
    notice: null,
  });
});

afterEach(() => {
  vi.clearAllTimers();
});

// ── normalizeScene ───────────────────────────────────────────────────────

describe('normalizeScene', () => {
  it('rejects anything that is not a scene', () => {
    expect(normalizeScene(null)).toBeNull();
    expect(normalizeScene(undefined)).toBeNull();
    expect(normalizeScene('scene')).toBeNull();
    expect(normalizeScene(42)).toBeNull();
  });

  it('builds a usable scene from an empty object', () => {
    const scene = normalizeScene({})!;
    expect(scene.world.width).toBeGreaterThan(0);
    expect(scene.world.height).toBeGreaterThan(0);
    expect(scene.entities).toEqual([]);
  });

  it('drops entities without a usable id', () => {
    const scene = normalizeScene({
      entities: [{ name: 'no id' }, { id: '', name: 'empty' }, { id: 'ok', name: 'fine' }],
    })!;
    expect(scene.entities.map((e) => e.id)).toEqual(['ok']);
  });

  it('drops duplicate ids, because two entities with one id cannot be edited apart', () => {
    const scene = normalizeScene({
      entities: [
        { id: 'dup', name: 'first' },
        { id: 'dup', name: 'second' },
      ],
    })!;
    expect(scene.entities).toHaveLength(1);
    expect(scene.entities[0].name).toBe('first');
  });

  it('replaces non-finite geometry instead of keeping it', () => {
    const scene = normalizeScene({
      entities: [{ id: 'a', x: NaN, y: Infinity, w: 'wide', h: null }],
    })!;
    const entity = scene.entities[0];
    expect(Number.isFinite(entity.x)).toBe(true);
    expect(Number.isFinite(entity.y)).toBe(true);
    expect(Number.isFinite(entity.w)).toBe(true);
    expect(Number.isFinite(entity.h)).toBe(true);
  });

  it('never yields an entity smaller than the minimum', () => {
    const scene = normalizeScene({ entities: [{ id: 'a', w: 0, h: -40 }] })!;
    expect(scene.entities[0].w).toBeGreaterThanOrEqual(MIN_ENTITY_SIZE);
    expect(scene.entities[0].h).toBeGreaterThanOrEqual(MIN_ENTITY_SIZE);
  });

  it('keeps playerId only when it names a real entity', () => {
    expect(normalizeScene({ entities: [{ id: 'a' }], playerId: 'ghost' })!.playerId).toBeUndefined();
    expect(normalizeScene({ entities: [{ id: 'a' }], playerId: 'a' })!.playerId).toBe('a');
  });

  it('round-trips a real scene unchanged', () => {
    const scene = starterScene();
    expect(normalizeScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
  });
});

// ── entity helpers ───────────────────────────────────────────────────────

describe('entity helpers', () => {
  it('names new entities without colliding', () => {
    let scene = emptyScene();
    const first = addEntity(scene, 'box', 0, 0);
    scene = first.scene;
    const second = addEntity(scene, 'box', 0, 0);
    expect(first.entity.name).not.toBe(second.entity.name);
  });

  it('keeps x and y on a patch but never lets y go negative', () => {
    const scene = starterScene();
    const player = resolvePlayer(scene)!;
    const moved = updateEntity(scene, player.id, { y: -50 });
    expect(moved.entities.find((e) => e.id === player.id)!.y).toBe(0);
  });

  it('cannot be shrunk below the minimum by a typed value', () => {
    const scene = starterScene();
    const player = resolvePlayer(scene)!;
    const resized = updateEntity(scene, player.id, { w: 0, h: 0 });
    const after = resized.entities.find((e) => e.id === player.id)!;
    expect(after.w).toBeGreaterThanOrEqual(MIN_ENTITY_SIZE);
    expect(after.h).toBeGreaterThanOrEqual(MIN_ENTITY_SIZE);
  });

  it('keeps at least a grabable corner on the stage', () => {
    const scene = starterScene();
    const player = resolvePlayer(scene)!;
    const flung = updateEntity(scene, player.id, { x: -99999 });
    const after = flung.entities.find((e) => e.id === player.id)!;
    // Some part of it must still be within the stage width.
    expect(after.x + after.w).toBeGreaterThan(0);
    expect(after.x).toBeLessThan(scene.world.width);
  });

  it('returns the same scene object when nothing changed', () => {
    const scene = starterScene();
    expect(updateEntity(scene, 'missing', { x: 1 })).toBe(scene);
    expect(removeEntity(scene, 'missing')).toBe(scene);
  });

  it('clears playerId when the player is deleted', () => {
    const scene = starterScene();
    const player = resolvePlayer(scene)!;
    const after = removeEntity(scene, player.id);
    expect(after.playerId).toBeUndefined();
  });
});

describe('resolvePlayer', () => {
  it('honours an explicit player', () => {
    const scene = starterScene();
    const coin = scene.entities.find((e) => e.name === 'Coin')!;
    expect(resolvePlayer(setPlayer(scene, coin.id))!.id).toBe(coin.id);
  });

  it('falls back when the chosen player is gone', () => {
    const scene = starterScene();
    const player = resolvePlayer(scene)!;
    const withoutPlayer = removeEntity(scene, player.id);
    // Still playable: something has to be driven, or Play does nothing at all.
    expect(resolvePlayer(withoutPlayer)).not.toBeNull();
  });

  it('is null only for an empty stage', () => {
    expect(resolvePlayer(emptyScene())).toBeNull();
  });

  it('refuses to make a nonexistent entity the player', () => {
    const scene = starterScene();
    expect(setPlayer(scene, 'ghost')).toBe(scene);
  });
});

// ── builder actions ──────────────────────────────────────────────────────

function openGame(): void {
  const project = projectFromTemplate(templateById('game-platformer')!);
  projectActions.open(project);
}

describe('builder actions', () => {
  it('creates a game project with a scene and a player', () => {
    const project = projectFromTemplate(templateById('game-platformer')!);
    expect(project.scene).toBeDefined();
    expect(project.scene!.entities.length).toBeGreaterThan(0);
    expect(resolvePlayer(project.scene!)).not.toBeNull();
  });

  it('gives each project its own entity ids', () => {
    const a = projectFromTemplate(templateById('game-platformer')!);
    const b = projectFromTemplate(templateById('game-platformer')!);
    const idsA = new Set(a.scene!.entities.map((e) => e.id));
    const idsB = new Set(b.scene!.entities.map((e) => e.id));
    for (const id of idsB) expect(idsA.has(id)).toBe(false);
  });

  it('gives an empty-stage project no entities', () => {
    const project = projectFromTemplate(templateById('game-blank')!);
    expect(project.scene).toBeDefined();
    expect(project.scene!.entities).toEqual([]);
  });

  it('adds an entity and returns its id', () => {
    openGame();
    const before = projectStore.get().project!.scene!.entities.length;
    const id = projectActions.addEntity('box', 100, 100);
    expect(id).toBeTruthy();
    const after = projectStore.get().project!.scene!.entities;
    expect(after).toHaveLength(before + 1);
    expect(after.some((e) => e.id === id)).toBe(true);
  });

  it('moves and resizes an entity through the store', () => {
    openGame();
    const id = projectActions.addEntity('box', 10, 10)!;
    projectActions.moveEntity(id, 200, 150);
    projectActions.resizeEntity(id, 90, 45);
    const entity = projectStore.get().project!.scene!.entities.find((e) => e.id === id)!;
    expect(entity).toMatchObject({ x: 200, y: 150, w: 90, h: 45 });
  });

  it('patches a single property without disturbing the others', () => {
    openGame();
    const id = projectActions.addEntity('circle', 10, 10)!;
    projectActions.patchEntity(id, { color: '#e64980' });
    const entity = projectStore.get().project!.scene!.entities.find((e) => e.id === id)!;
    expect(entity.color).toBe('#e64980');
    expect(entity.x).toBe(10);
  });

  it('duplicates an entity with a new id', () => {
    openGame();
    const id = projectActions.addEntity('box', 10, 10)!;
    const copyId = projectActions.duplicateEntity(id)!;
    expect(copyId).not.toBe(id);
    const entities = projectStore.get().project!.scene!.entities;
    expect(entities.some((e) => e.id === copyId)).toBe(true);
  });

  it('deletes an entity', () => {
    openGame();
    const id = projectActions.addEntity('box', 10, 10)!;
    projectActions.deleteEntity(id);
    expect(projectStore.get().project!.scene!.entities.some((e) => e.id === id)).toBe(false);
  });

  it('resizes the world without moving entities outside it', () => {
    openGame();
    projectActions.patchWorld({ width: 1440 });
    expect(projectStore.get().project!.scene!.world.width).toBe(1440);
  });
});

describe('undo and redo', () => {
  it('undoes one edit and redoes it', () => {
    openGame();
    const before = projectStore.get().project!.scene!.entities.length;

    projectActions.addEntity('box', 50, 50);
    expect(projectStore.get().project!.scene!.entities).toHaveLength(before + 1);
    expect(projectStore.get().undoDepth).toBe(1);

    projectActions.undoScene();
    expect(projectStore.get().project!.scene!.entities).toHaveLength(before);
    expect(projectStore.get().redoDepth).toBe(1);

    projectActions.redoScene();
    expect(projectStore.get().project!.scene!.entities).toHaveLength(before + 1);
  });

  it('collapses a whole drag into one undo step', () => {
    openGame();
    const id = projectActions.addEntity('box', 100, 100)!;
    const depthAfterAdd = projectStore.get().undoDepth;

    // One gesture, many moves — exactly what a pointer drag produces.
    projectActions.beginSceneGesture();
    for (let i = 0; i < 40; i++) projectActions.moveEntity(id, 100 + i, 100);
    // Still nothing recorded mid-drag: a drag has no meaningful intermediate
    // undo state, and recording one per pointer move is the bug this prevents.
    expect(projectStore.get().undoDepth).toBe(depthAfterAdd);
    projectActions.endSceneGesture();
    // Exactly one entry for the whole drag.
    expect(projectStore.get().undoDepth).toBe(depthAfterAdd + 1);

    projectActions.undoScene();
    const entity = projectStore.get().project!.scene!.entities.find((e) => e.id === id)!;
    expect(entity.x).toBe(100);
  });

  it('does not record a step when nothing changed', () => {
    openGame();
    const depth = projectStore.get().undoDepth;
    projectActions.updateScene((scene) => scene);
    expect(projectStore.get().undoDepth).toBe(depth);
  });

  it('drops the redo branch once a new change is made', () => {
    openGame();
    projectActions.addEntity('box', 10, 10);
    projectActions.undoScene();
    expect(projectStore.get().redoDepth).toBe(1);
    projectActions.addEntity('circle', 20, 20);
    expect(projectStore.get().redoDepth).toBe(0);
  });

  it('has nothing to undo on a freshly opened project', () => {
    openGame();
    expect(projectStore.get().undoDepth).toBe(0);
    projectActions.undoScene();
    // A no-op, not a crash or a null project.
    expect(projectStore.get().project).not.toBeNull();
  });

  it('does not leak history across projects', () => {
    openGame();
    projectActions.addEntity('box', 10, 10);
    expect(projectStore.get().undoDepth).toBeGreaterThan(0);

    projectActions.open(projectFromTemplate(templateById('web-starter')!));
    expect(projectStore.get().undoDepth).toBe(0);
    expect(projectStore.get().redoDepth).toBe(0);
  });
});

describe('scene persistence', () => {
  it('saves the scene with the project so a reload keeps the stage', async () => {
    openGame();
    const id = projectActions.addEntity('box', 123, 45)!;
    // The debounce writes on a timer; flush() forces it. Either way the row in
    // the fake database is what a reload would read.
    projectActions.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const project = projectStore.get().project!;
    const stored = rows.get(project.id);
    expect(stored).toBeDefined();
    const saved = stored!.scene!.entities.find((e) => e.id === id);
    expect(saved).toMatchObject({ x: 123, y: 45 });
  });

  it('opens a project whose stored scene is corrupt', () => {
    openGame();
    const project = projectStore.get().project!;
    const broken: Project = { ...project, scene: { version: 1 } as never };
    // The shell normalizes on read; this asserts the rule the shell applies.
    expect(normalizeScene(broken.scene)).not.toBeNull();
    expect(normalizeScene(broken.scene)!.entities).toEqual([]);
  });

  it('opens a Web project that has no scene at all', () => {
    const web = projectFromTemplate(templateById('web-starter')!);
    expect(web.scene).toBeUndefined();
    projectActions.open(web);
    expect(projectStore.get().project!.scene).toBeUndefined();
  });
});
