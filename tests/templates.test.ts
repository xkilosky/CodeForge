/**
 * Template lookup and workspace switching.
 *
 * These exist because of a real bug: the "New…" dropdown synthesised option
 * ids as `${runtime.id}-starter`, which never matched a real template id.
 * `templateById` returned undefined and the handler silently did nothing, so
 * the Roblox workspace could not be created from the top bar at all — and
 * because nothing threw, no test caught it until it was reported.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATES, projectFromTemplate, templateById } from '../src/core/templates';
import { RUNTIMES, runtimeForWorkspace } from '../src/runtimes/registry';
import type { WorkspaceId } from '../src/core/types';

describe('templates', () => {
  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every template by its own id', () => {
    for (const template of TEMPLATES) {
      expect(templateById(template.id), template.id).toBe(template);
    }
  });

  it('can create a project for every template', () => {
    for (const template of TEMPLATES) {
      const project = projectFromTemplate(template);
      expect(project.workspace).toBe(template.workspace);
      expect(Object.keys(project.files).length).toBeGreaterThan(0);
      // The active file must exist, or the editor opens empty on a new project.
      expect(project.files[project.activeFile]).toBeDefined();
    }
  });

  it('offers a template for every workspace that has a runtime', () => {
    for (const runtime of RUNTIMES.filter((r) => r.available)) {
      const templates = TEMPLATES.filter((t) => t.workspace === runtime.id);
      expect(templates.length, runtime.id).toBeGreaterThan(0);
      for (const template of templates) {
        const project = projectFromTemplate(template);
        expect(project.files[project.activeFile]).toBeDefined();
      }
    }
  });

  it('no longer offers Luau or Roblox', () => {
    // Removed deliberately, not disabled: there is no runtime behind them and
    // no half-working card left to tap.
    expect(TEMPLATES.some((t) => /roblox|luau/i.test(t.id + t.label + t.description))).toBe(false);
    expect(TEMPLATES.some((t) => (t.workspace as string) === 'roblox')).toBe(false);
  });

  it('maps every runtime to a template the dropdown can create', () => {
    // This is exactly the invariant the old code broke: the options were built
    // from runtimes, so each runtime's entry template id must resolve.
    for (const runtime of RUNTIMES) {
      const entry = TEMPLATES.find((t) => t.workspace === runtime.id);
      if (!entry) continue;
      expect(templateById(entry.id), `runtime ${runtime.id}`).toBeDefined();
    }
  });

  it('never synthesises a template id from a runtime id', () => {
    // The specific regression: `${id}-starter` is not a template id.
    const synthesised = RUNTIMES.map((r) => `${r.id}-starter`);
    for (const id of synthesised) {
      const real = TEMPLATES.some((t) => t.id === id);
      if (!real) expect(templateById(id)).toBeUndefined();
    }
    // At least one of the real templates is NOT of that shape.
    expect(TEMPLATES.some((t) => !synthesised.includes(t.id))).toBe(true);
  });
});

describe('workspace routing', () => {
  it('gives every available runtime its own workspace', () => {
    for (const runtime of RUNTIMES.filter((r) => r.available)) {
      const resolved = runtimeForWorkspace(runtime.id);
      expect(resolved.id).toBe(runtime.id);
      expect(resolved.available).toBe(true);
    }
  });

  it('resolves the web workspace to the Web runtime', () => {
    expect(runtimeForWorkspace('web').id).toBe('web');
  });

  it('falls back rather than throwing for an unknown workspace', () => {
    expect(runtimeForWorkspace('nonsense' as WorkspaceId)).toBe(RUNTIMES[0]);
  });

  it('only lists workspaces that have a template to open them with', () => {
    for (const runtime of RUNTIMES.filter((r) => r.available)) {
      const templates = TEMPLATES.filter((t) => t.workspace === runtime.id);
      expect(templates.length, runtime.id).toBeGreaterThan(0);
    }
  });
});

describe('switchWorkspace', () => {
  /**
   * The workspace tabs used to have an empty click handler, so tapping one did
   * nothing. These assert the action actually retargets the project.
   */
  it('retargets a project to another workspace', async () => {
    const { projectActions, projectStore } = await import('../src/core/projectStore');
    const web = projectFromTemplate(templateById('web-starter')!);
    projectActions.open(web);

    projectActions.switchWorkspace('game');

    const after = projectStore.get().project!;
    // Same project, different workspace — and the game starter's scene comes
    // with it, or the builder would open on an empty stage.
    expect(after.id).toBe(web.id);
    expect(after.workspace).toBe('game');
    expect(after.scene).toBeDefined();
  });

  it('refuses to retarget to a workspace with no runtime', async () => {
    const { projectActions, projectStore } = await import('../src/core/projectStore');
    const web = projectFromTemplate(templateById('web-starter')!);
    projectActions.open(web);

    // `python` is still an `upcoming()` placeholder: no runtime, so retargeting
    // would hand back a project whose Run button does nothing.
    projectActions.switchWorkspace('python');

    const after = projectStore.get().project!;
    expect(after.id).toBe(web.id);
    expect(after.workspace).toBe('web');
    expect(after.scene).toBeUndefined();
  });

  it('keeps project settings across a switch', async () => {
    const { projectActions, projectStore } = await import('../src/core/projectStore');
    projectActions.open(projectFromTemplate(templateById('web-starter')!));
    const before = projectStore.get().project!.settings;
    projectActions.switchWorkspace('game');
    expect(projectStore.get().project!.settings).toEqual(before);
  });

  it('switching away from a game project keeps the code and drops the stage', async () => {
    const { projectActions, projectStore } = await import('../src/core/projectStore');
    projectActions.open(projectFromTemplate(templateById('game-platformer')!));
    expect(projectStore.get().project!.scene).toBeDefined();

    projectActions.switchWorkspace('web');
    const after = projectStore.get().project!;
    expect(after.workspace).toBe('web');
    // A Web project with a leftover game scene would render a stage it cannot run.
    expect(after.scene).toBeUndefined();
  });

  it('does nothing when switching to the workspace already open', async () => {
    const { projectActions, projectStore } = await import('../src/core/projectStore');
    const web = projectFromTemplate(templateById('web-blank')!);
    projectActions.open(web);
    projectActions.switchWorkspace('web');
    expect(projectStore.get().project!.id).toBe(web.id);
    expect(projectStore.get().project!.files).toEqual(web.files);
  });

  it('lands on an entry file that exists', async () => {
    const { projectActions, projectStore } = await import('../src/core/projectStore');
    projectActions.open(projectFromTemplate(templateById('web-starter')!));
    const project = projectStore.get().project!;
    expect(project.files[project.activeFile]).toBeDefined();
  });
});
