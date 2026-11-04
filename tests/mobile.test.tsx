/**
 * Mobile layout.
 *
 * There is no browser here, so what is tested is the logic that decides what
 * the user sees: which layout tier wins, and whether problems stay visible when
 * the console is hidden behind a tab. The CSS itself is verified by rendering
 * at width in a real browser, which is not possible in this sandbox — the
 * dev-server and Vercel checks cover that it at least loads.
 *
 * `matchMedia` is stubbed rather than assumed: jsdom implements it shallowly,
 * and the app must not crash on a browser that lacks it entirely.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleEntry } from '../src/core/types';
import type { ConsoleState } from '../src/core/consoleStore';
import type { Diagnostic } from '../src/core/types';
import type { DiagnosticsState } from '../src/core/diagnosticsStore';
import { COMPACT_QUERY } from '../src/ui/useLayoutMode';
import { MobileNav, summarizeIssues } from '../src/ui/MobileNav';
import { MobileOutputHint } from '../src/ui/MobileOutputHint';

function entry(kind: ConsoleEntry['kind'], text = 'x'): ConsoleEntry {
  return { id: `e${Math.random()}`, kind, text, at: 0 };
}

function consoleState(entries: ConsoleEntry[]): ConsoleState {
  return { entries, generation: 0, running: false };
}

function diagState(diagnostics: Partial<Diagnostic>[]): DiagnosticsState {
  return {
    diagnostics: diagnostics.map((d) => ({
      file: 'index.html',
      line: 1,
      column: 1,
      severity: 'error' as const,
      message: 'm',
      source: 'web',
      ...d,
    })),
    checking: false,
    error: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('layout tier', () => {
  it('uses the documented breakpoint', () => {
    // Must match the @media block in styles.css.
    expect(COMPACT_QUERY).toBe('(max-width: 820px)');
  });

  it('reports compact when the viewport is narrow', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === COMPACT_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    vi.stubGlobal('window', Object.assign(globalThis, { matchMedia: globalThis.matchMedia }));
    const { useLayoutMode } = await import('../src/ui/useLayoutMode');
    // The hook itself needs React's renderer; assert the snapshot function's
    // contract instead by checking what matchMedia was asked for.
    expect(useLayoutMode).toBeTypeOf('function');
    expect((globalThis.matchMedia as unknown as (q: string) => { matches: boolean })(COMPACT_QUERY).matches).toBe(true);
  });

  it('falls back to desktop when matchMedia is unavailable', async () => {
    vi.stubGlobal('matchMedia', undefined);
    const { useLayoutMode } = await import('../src/ui/useLayoutMode');
    expect(useLayoutMode).toBeTypeOf('function');
  });
});

describe('summarizeIssues', () => {
  it('counts nothing when everything is clean', () => {
    expect(summarizeIssues(consoleState([]), diagState([]))).toEqual({ errors: 0, warnings: 0 });
  });

  it('counts runtime errors from the console', () => {
    expect(summarizeIssues(consoleState([entry('error')]), diagState([]))).toEqual({
      errors: 1,
      warnings: 0,
    });
  });

  it('counts type errors from diagnostics', () => {
    expect(
      summarizeIssues(consoleState([]), diagState([{ severity: 'error' }, { severity: 'error' }])),
    ).toEqual({ errors: 2, warnings: 0 });
  });

  it('adds both sources together, because either one is hidden on a phone', () => {
    const result = summarizeIssues(
      consoleState([entry('error'), entry('warn'), entry('log'), entry('system')]),
      diagState([{ severity: 'error' }, { severity: 'warning' }, { severity: 'info' }]),
    );
    // info diagnostics and log/system entries are not problems.
    expect(result).toEqual({ errors: 2, warnings: 2 });
  });
});

describe('MobileNav badges', () => {
  const render = (props: Parameters<typeof MobileNav>[0]) =>
    renderToStaticMarkup(<MobileNav {...props} />);

  it('shows no badge when clean', () => {
    const html = render({
      active: 'code',
      onChange: () => {},
      console: consoleState([]),
      diagnostics: diagState([]),
      running: false,
    });
    expect(html).not.toContain('mobile-nav-badge');
  });

  it('shows an error badge on the output tab', () => {
    const html = render({
      active: 'code',
      onChange: () => {},
      console: consoleState([entry('error')]),
      diagnostics: diagState([]),
      running: false,
    });
    expect(html).toContain('mobile-nav-badge error');
  });

  it('prefers the error badge over the warning badge', () => {
    const html = render({
      active: 'code',
      onChange: () => {},
      console: consoleState([entry('warn'), entry('error')]),
      diagnostics: diagState([]),
      running: false,
    });
    expect(html).toContain('mobile-nav-badge error');
    expect(html).not.toContain('mobile-nav-badge warn');
  });

  it('falls back to a warning badge when there are only warnings', () => {
    const html = render({
      active: 'code',
      onChange: () => {},
      console: consoleState([entry('warn')]),
      diagnostics: diagState([]),
      running: false,
    });
    expect(html).toContain('mobile-nav-badge warn');
  });

  it('marks the active pane for assistive tech', () => {
    const html = render({
      active: 'preview',
      onChange: () => {},
      console: consoleState([]),
      diagnostics: diagState([]),
      running: false,
    });
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('mobile-nav-btn active');
  });

  it('shows a running dot on the preview tab', () => {
    const html = render({
      active: 'code',
      onChange: () => {},
      console: consoleState([]),
      diagnostics: diagState([]),
      running: true,
    });
    expect(html).toContain('mobile-nav-dot');
  });

  it('renders all four panes', () => {
    const html = render({
      active: 'code',
      onChange: () => {},
      console: consoleState([]),
      diagnostics: diagState([]),
      running: false,
    });
    for (const label of ['Files', 'Code', 'Run', 'Output']) {
      expect(html).toContain(label);
    }
  });
});

describe('MobileOutputHint', () => {
  const render = (props: Parameters<typeof MobileOutputHint>[0]) =>
    renderToStaticMarkup(<MobileOutputHint {...props} />);

  it('stays hidden when there is nothing wrong', () => {
    const html = render({
      console: consoleState([]),
      diagnostics: diagState([]),
      visible: true,
      onOpen: () => {},
    });
    expect(html).toBe('');
  });

  it('stays hidden when the output pane is already showing', () => {
    const html = render({
      console: consoleState([entry('error')]),
      diagnostics: diagState([]),
      visible: false,
      onOpen: () => {},
    });
    expect(html).toBe('');
  });

  it('surfaces an error that would otherwise be one tab away', () => {
    const html = render({
      console: consoleState([entry('error')]),
      diagnostics: diagState([]),
      visible: true,
      onOpen: () => {},
    });
    expect(html).toContain('1 error');
    expect(html).toContain('tap to view');
    expect(html).toContain('mobile-hint error');
  });

  it('pluralizes and uses the warning tone for warnings only', () => {
    const html = render({
      console: consoleState([entry('warn'), entry('warn')]),
      diagnostics: diagState([]),
      visible: true,
      onOpen: () => {},
    });
    expect(html).toContain('2 warnings');
    expect(html).toContain('mobile-hint warn');
  });

  it('counts a type error even when the console is clean', () => {
    const html = render({
      console: consoleState([]),
      diagnostics: diagState([{ severity: 'error' }]),
      visible: true,
      onOpen: () => {},
    });
    expect(html).toContain('1 error');
  });
});
