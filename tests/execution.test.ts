/**
 * Two defects that reached the browser.
 *
 * 1. "another Lua execute operation is already active". `LuaWorker` refuses a
 *    second concurrent operation *by rejecting*, it does not queue. The
 *    simulation loop fires a tick from `requestAnimationFrame` whenever its
 *    interval has elapsed, including while the previous tick is still in
 *    flight, so the rejection was guaranteed whenever a tick outlived its
 *    interval. Worse, three of them in a row tore the simulation down with a
 *    message blaming the user's script.
 *
 * 2. "There only one project?" — `init()` auto-opened the most recent project,
 *    and the projects list only rendered when *no* project was open. So the
 *    list was unreachable regardless of how many projects existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/core/types';
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
const { serializeRuns } = await import('../src/runtimes/luau/runGate');

function seed(templateId: string, name?: string): Project {
  const project = projectFromTemplate(templateById(templateId)!, name);
  rows.set(project.id, project);
  return project;
}

beforeEach(() => {
  rows.clear();
  projectStore.set({ project: null, recent: [], loading: false, dirty: false, error: null });
});

afterEach(() => vi.restoreAllMocks());

describe('the app starts on the projects list', () => {
  it('does not open a project on init, no matter how many are saved', async () => {
    seed('web-starter', 'one');
    seed('roblox-physics', 'two');

    await projectActions.init();

    // Opening the newest project is what hid the list and made the app look
    // like it only contained one project.
    expect(projectStore.get().project).toBeNull();
    expect(projectStore.get().recent).toHaveLength(2);
    expect(projectStore.get().loading).toBe(false);
  });

  it('keeps every saved project listed, newest first', async () => {
    const older = seed('web-starter', 'older');
    const newer = seed('roblox-physics', 'newer');
    older.updatedAt = Date.now() - 86_400_000;
    rows.set(older.id, older);

    await projectActions.init();

    expect(projectStore.get().recent.map((p) => p.name)).toEqual(['newer', 'older']);
    expect(newer.id).toBe(projectStore.get().recent[0].id);
  });

  it('starts empty rather than erroring when there is nothing saved', async () => {
    await projectActions.init();
    expect(projectStore.get().project).toBeNull();
    expect(projectStore.get().recent).toEqual([]);
  });
});

describe('serializeRuns — one Lua operation at a time', () => {
  it('runs tasks one at a time, in order, and never overlaps', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const release: (() => void)[] = [];
    const task = (name: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(name);
      await new Promise<void>((resolve) => release.push(resolve));
      active -= 1;
    };

    const a = serializeRuns(task('a'));
    const b = serializeRuns(task('b'));
    const c = serializeRuns(task('c'));

    // Nothing has finished yet: only the first task may be running.
    await Promise.resolve();
    expect(order).toEqual(['a']);

    release.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a', 'b']);

    release.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a', 'b', 'c']);

    release.shift()!();
    await Promise.all([a, b, c]);

    // The property the worker enforces, and what the loop used to violate.
    expect(maxActive).toBe(1);
  });

  it('keeps the queue moving after a task rejects', async () => {
    const first = serializeRuns(async () => {
      throw new Error('another Lua execute operation is already active');
    });
    const second = serializeRuns(async () => 'ran');

    await expect(first).rejects.toThrow(/already active/);
    // A rejection must not poison the chain, or every later tick would fail
    // with the first error forever.
    await expect(second).resolves.toBe('ran');
  });

  it('serialises a whole burst instead of dropping ticks', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 12 }, (_, i) =>
      serializeRuns(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, i % 3));
        active -= 1;
        return i;
      }),
    );

    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(maxActive).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The start/stop race
 * ------------------------------------------------------------------ */

describe('overlapping runs', () => {
  /**
   * `startRun` awaits the runtime, and a runtime does real work before it
   * returns a handle. During that window `handle` is null, so a second
   * `startRun` had nothing to stop and both executions survived — two physics
   * loops publishing into one scene store, with the first unstoppable.
   */
  it('discards a run that resolves after a newer one started', async () => {
    const { startRun, stopRun, runStore } = await import('../src/core/runSession');
    stopRun();

    const stopped: string[] = [];
    let releaseFirst: (() => void) | null = null;

    const first = startRun(async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return { stop: () => stopped.push('first') };
    });

    // A second run starts while the first is still booting.
    const second = startRun(async () => ({ stop: () => stopped.push('second') }));

    releaseFirst!();
    await Promise.all([first, second]);

    // The stale run must have stopped itself rather than becoming the handle.
    expect(stopped).toContain('first');
    expect(runStore.get().running).toBe(true);

    stopRun();
    expect(stopped).toContain('second');
    expect(runStore.get().running).toBe(false);
  });

  it('leaves exactly one run alive and counting', async () => {
    const { startRun, stopRun, runStore } = await import('../src/core/runSession');
    stopRun();
    const before = runStore.get().runCount;

    await Promise.all([
      startRun(async () => ({ stop() {} })),
      startRun(async () => ({ stop() {} })),
      startRun(async () => ({ stop() {} })),
    ]);

    // Three starts, but the counter tracks the survivor.
    expect(runStore.get().runCount - before).toBeLessThanOrEqual(1);
    stopRun();
  });

  it('reports a stale run that throws without clobbering the live one', async () => {
    const { startRun, stopRun, runStore } = await import('../src/core/runSession');
    stopRun();

    const logs: string[] = [];
    const { io } = await import('../src/core/consoleStore');
    const original = io.log;
    io.log = (entry) => logs.push(entry.text);

    let failFirst: ((e: Error) => void) | null = null;
    const first = startRun(async () => {
      await new Promise<void>((_resolve, reject) => {
        failFirst = reject;
      });
      return { stop() {} };
    });
    const second = startRun(async () => ({ stop() {} }));
    failFirst!(new Error('worker died'));
    await Promise.all([first, second]);

    // The dead run's error belongs to a run the user already replaced.
    expect(logs.join(' ')).not.toContain('worker died');
    expect(runStore.get().running).toBe(true);
    io.log = original;
    stopRun();
  });
});
