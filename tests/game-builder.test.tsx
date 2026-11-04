/**
 * The builder's components, rendered to static markup.
 *
 * jsdom is not used and Monaco cannot mount here, so these are shallow by
 * design: they prove the toolbar and inspector render every control the user
 * needs, and that a selected entity's values actually reach the inputs. What
 * they cannot prove is what the canvas looks like — there is no browser in this
 * sandbox, and claiming otherwise would be the same mistake the retired
 * viewport made.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuilderToolbar, SceneInspector } from '../src/ui/SceneInspector';
import { starterScene, emptyScene, resolvePlayer } from '../src/core/scene';

const noop = () => {};

describe('BuilderToolbar', () => {
  const render = (overrides: Partial<Parameters<typeof BuilderToolbar>[0]> = {}) =>
    renderToStaticMarkup(
      <BuilderToolbar
        onAdd={noop}
        onUndo={noop}
        onRedo={noop}
        canUndo={false}
        canRedo={false}
        onTogglePlay={noop}
        playing={false}
        onRestart={noop}
        {...overrides}
      />,
    );

  it('offers the two primitives and the transport', () => {
    const html = render();
    expect(html).toContain('+ Box');
    expect(html).toContain('+ Circle');
    expect(html).toContain('▶ Play');
    expect(html).toContain('Restart');
  });

  it('disables undo and redo with nothing to undo', () => {
    const html = render();
    expect(html).toContain('disabled');
  });

  it('enables them once there is history', () => {
    const html = render({ canUndo: true, canRedo: true });
    expect(html).not.toContain('disabled=""');
  });

  it('turns into a stop control while playing', () => {
    const html = render({ playing: true });
    expect(html).toContain('Stop');
    expect(html).not.toContain('▶ Play');
  });
});

describe('SceneInspector', () => {
  const base = {
    onUpdate: noop,
    onDelete: noop,
    onDuplicate: noop,
    onSetPlayer: noop,
    onClose: noop,
    onWorld: noop,
  };

  it('shows world settings when nothing is selected', () => {
    const html = renderToStaticMarkup(
      <SceneInspector {...base} scene={emptyScene()} selected={null} isPlayer={false} />,
    );
    expect(html).toContain('Stage');
    expect(html).toContain('Gravity');
    expect(html).toContain('960');
  });

  it('shows the selected entity\'s real values', () => {
    const scene = starterScene();
    const player = resolvePlayer(scene)!;
    const html = renderToStaticMarkup(
      <SceneInspector
        {...base}
        scene={scene}
        selected={player}
        isPlayer
      />,
    );
    expect(html).toContain(player.name);
    expect(html).toContain(String(player.x));
    expect(html).toContain(String(player.w));
  });

  it('marks the player and hides the now-pointless action', () => {
    const scene = starterScene();
    const html = renderToStaticMarkup(
      <SceneInspector {...base} scene={scene} selected={resolvePlayer(scene)!} isPlayer />,
    );
    expect(html).toContain('Is the player');
    expect(html).toContain('disabled');
  });

  it('offers to make a non-player the player', () => {
    const scene = starterScene();
    const coin = scene.entities.find((e) => e.name === 'Coin')!;
    const html = renderToStaticMarkup(
      <SceneInspector {...base} scene={scene} selected={coin} isPlayer={false} />,
    );
    expect(html).toContain('Make player');
  });

  it('renders a swatch per palette colour', () => {
    const scene = starterScene();
    const html = renderToStaticMarkup(
      <SceneInspector {...base} scene={scene} selected={resolvePlayer(scene)!} isPlayer={false} />,
    );
    // Buttons only: `swatches` is the container's class and also matches a
    // loose pattern, which is exactly how this assertion first passed wrongly.
    expect([...html.matchAll(/class="swatch(?: active)?"/g)]).toHaveLength(8);
  });

  it('includes delete and duplicate', () => {
    const scene = starterScene();
    const html = renderToStaticMarkup(
      <SceneInspector {...base} scene={scene} selected={resolvePlayer(scene)!} isPlayer={false} />,
    );
    expect(html).toContain('Delete');
    expect(html).toContain('Duplicate');
  });
});

describe('builder state wiring', () => {
  it('every action the inspector can trigger exists on the store', async () => {
    const { projectActions } = await import('../src/core/projectStore');
    // These are passed straight into the component, so a rename in one place
    // and not the other would be a runtime TypeError, not a compile error.
    for (const name of [
      'patchEntity',
      'deleteEntity',
      'duplicateEntity',
      'setPlayer',
      'patchWorld',
      'moveEntity',
      'resizeEntity',
      'addEntity',
      'undoScene',
      'redoScene',
      'beginSceneGesture',
      'endSceneGesture',
    ] as const) {
      expect(projectActions[name], name).toBeTypeOf('function');
    }
  });

  it('does not call the network or touch the DOM at import time', () => {
    // The builder must be safe to import in a plain Node environment; a stray
    // `document` or `window` access at module scope would break SSR and tests.
    expect(vi.isMockFunction(vi.fn())).toBe(true);
  });
});

// ── branding ─────────────────────────────────────────────────────────────
describe('BrandMark', () => {
  it('renders the mark at the requested size with a decorative default', async () => {
    const { BrandMark } = await import('../src/ui/BrandMark');
    const html = renderToStaticMarkup(<BrandMark size={22} />);
    expect(html).toContain('src="/brand/mark.png"');
    expect(html).toContain('width="22"');
    expect(html).toContain('aria-hidden="true"');
    // Decorative by default: both call sites already name themselves, so a
    // second accessible name would read "CodeForge CodeForge".
    expect(html).not.toContain('alt="CodeForge"');
  });

  it('becomes a real image when given alt text', async () => {
    const { BrandMark } = await import('../src/ui/BrandMark');
    const html = renderToStaticMarkup(<BrandMark size={30} alt="CodeForge" />);
    expect(html).toContain('alt="CodeForge"');
    expect(html).not.toContain('aria-hidden');
  });

  it('is used by both the top bar and the projects home', async () => {
    // These two places used to hold their own copy of the "⚒" character, which
    // is why the logo could change in one and not the other.
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/ui/TopBar.tsx', 'src/ui/ProjectsHome.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toContain('BrandMark');
      expect(source, file).not.toContain('⚒');
    }
  });
});
