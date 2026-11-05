/**
 * The shell's layout classes.
 *
 * CSS cannot be asserted in this sandbox — there is no browser to compute a
 * grid with. What *can* be asserted is the contract the CSS depends on: which
 * class the shell puts on itself for each combination of viewport and pin
 * state. Every one of these was a real layout bug during the build:
 *
 *   - a wrapping flex row put the pinned drawer *above* the top bar
 *   - an `auto` grid track still reserved a column for a hidden drawer
 *   - a pinned drawer on a phone covered the whole screen
 *
 * The classes are the only thing standing between markup and those outcomes, so
 * they are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { layoutStore, layoutActions } from '../src/core/layoutStore';

describe('shell classes', () => {
  it('has a class for a pinned drawer and one for an unpinned drawer', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    // A pinned drawer is a grid track; an unpinned one must not reserve one.
    expect(css).toContain('.app.has-drawer {');
    expect(css).toContain('.app.has-drawer.unpinned { grid-template-columns: 0 minmax(0, 1fr); }');
    // The bar has to sit above both columns, not inside one.
    expect(css).toContain('"bar bar"');
    expect(css).toContain('"drawer main"');
  });

  it('anchors the overlay drawer under the bar rather than over it', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.drawer \{[^}]*top: var\(--topbar-h\)/s);
  });

  it('binds Ctrl+B to the pin on a wide screen', () => {
    // Toggling the overlay there would look like nothing happened, because the
    // drawer stays pinned open.
    const app = readFileSync('src/App.tsx', 'utf8');
    const handler = app.slice(app.indexOf("key === 'b'"), app.indexOf("key === 'p'"));
    expect(handler).toContain("layout === 'desktop'");
    expect(handler).toContain('toggleDrawerPinned');
  });

  it('never pins the drawer on a phone', () => {
    // On a narrow screen the drawer is an overlay only: 274px of tree on a
    // 390px viewport is not a sidebar.
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("layout === 'desktop' && project");
    expect(app).toContain("? ' has-drawer'");
    expect(app).toContain(": ' has-drawer unpinned'");
  });
});

describe('layout preference', () => {
  it('defaults to a pinned drawer and split view', () => {
    layoutActions.reset();
    const state = layoutStore.get();
    expect(state.drawerPinned).toBe(true);
    expect(state.arrangement).toBe('split');
  });

  it('toggles the pin and the arrangement', () => {
    layoutActions.reset();
    layoutActions.toggleDrawerPinned();
    expect(layoutStore.get().drawerPinned).toBe(false);
    layoutActions.setArrangement('focus');
    expect(layoutStore.get().arrangement).toBe('focus');
    layoutActions.reset();
  });

  it('does not crash when there is no localStorage', async () => {
    // A sandboxed iframe and some private modes throw on access. A layout
    // preference is not worth an exception on boot.
    const { loadLayout } = await import('../src/core/layoutStore');
    expect(() => loadLayout()).not.toThrow();
  });

  it('marks the drawer as seen exactly once', () => {
    layoutActions.reset();
    layoutActions.markDrawerSeen();
    expect(layoutStore.get().seenDrawer).toBe(true);
    layoutActions.markDrawerSeen();
    expect(layoutStore.get().seenDrawer).toBe(true);
  });
});
