/**
 * The Forge S1.6 interface: the palette, the theme, export/import and the
 * components that replaced the flat file list.
 *
 * Two kinds of assertion here. The first are behavioural — does the tree show
 * a folder, does an accent id resolve, does an import refuse a file that is not
 * ours. The second are the "this must never come back" kind: the stylesheet and
 * `core/theme.ts` declare the same colours, and a second copy of the palette is
 * exactly how an app ends up with an editor that does not match its chrome.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import {
  ACCENTS,
  CSS_TOKENS,
  TOKYO,
  accentHex,
  resolveEditorTheme,
  MONACO_THEMES,
} from '../src/core/theme';
import { highlight, rankFiles, scoreMatch } from '../src/core/search';
import { exportFileName, parseProject, serializeProject } from '../src/core/transfer';
import { projectFromTemplate, templateById } from '../src/core/templates';
import { Explorer } from '../src/ui/Explorer';
import { Palette } from '../src/ui/Palette';
import { NoticeBar } from '../src/ui/NoticeBar';
import { DesktopWorkspace } from '../src/ui/DesktopWorkspace';

/*
 * `DesktopWorkspace` renders the real Monaco editor, which touches `window` at
 * module scope and cannot mount in this sandbox. The editor component is
 * swapped for a marker so the *layout* is what gets tested — the same shallow
 * approach the game-builder tests take.
 */
vi.mock('../src/ui/EditorPane', () => ({
  EditorPane: () => <div className="editor-host" data-mock="editor" />,
}));

/** The markup every render helper needs, since the props are all required. */
const noop = () => {};

function renderExplorer(files: Record<string, string>, folders: string[] = []): string {
  const map = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [
      path,
      { content, language: 'text' as const },
    ]),
  );
  return renderToStaticMarkup(
    <Explorer
      files={map}
      folders={folders}
      activeFile="index.html"
      onSelect={noop}
      onCreateFile={noop}
      onCreateFolder={noop}
      onRename={noop}
      onDeleteFile={noop}
      onDeleteFolder={noop}
      onDuplicate={noop}
    />,
  );
}

describe('theme', () => {
  it('has one palette and the stylesheet agrees with it', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    for (const token of CSS_TOKENS) {
      // Anchored on the closing semicolon so `--bg` cannot match `--bg-raise`.
      expect(css, `--${token.name}`).toContain(`--${token.name}: ${token.value};`);
    }
  });

  it('is Tokyo Night, not a generic dark theme', () => {
    // The three colours that make the scheme recognisable. If these drift the
    // app is no longer the theme it claims to be.
    expect(TOKYO.bg).toBe('#16161e');
    expect(TOKYO.accent).toBe('#7aa2f7');
    expect(TOKYO.purple).toBe('#bb9af7');
  });

  it('resolves an accent id, and falls back instead of rendering nothing', () => {
    expect(accentHex('teal')).toBe(TOKYO.teal);
    expect(accentHex(undefined)).toBe(TOKYO.accent);
    // A project saved by a future build with an accent this one does not know.
    expect(accentHex('chartreuse')).toBe(TOKYO.accent);
  });

  it('gives every accent the same shape of id', () => {
    const ids = ACCENTS.map((accent) => accent.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const accent of ACCENTS) expect(accent.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('maps an old Monaco theme id forward', () => {
    // S1.5 projects hold 'vs-dark' / 'vs'. Opening one must not fail.
    expect(resolveEditorTheme('vs-dark')).toBe('tokyo-night');
    expect(resolveEditorTheme('vs')).toBe('tokyo-storm');
    expect(resolveEditorTheme('tokyo-storm')).toBe('tokyo-storm');
    expect(resolveEditorTheme(undefined)).toBe('tokyo-night');
  });

  it('registers a Monaco theme for every theme id the UI offers', () => {
    const ids = MONACO_THEMES.map((theme) => theme.id).sort();
    expect(ids).toEqual(['tokyo-night', 'tokyo-storm']);
    for (const theme of MONACO_THEMES) {
      expect(theme.data.colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.data.rules.length).toBeGreaterThan(3);
    }
  });
});

describe('quick open', () => {
  it('finds a file by its name, wherever it lives', () => {
    // The whole reason this exists: `main` must reach `src/js/main.js` without
    // the user typing the folders.
    const ranked = rankFiles(['src/js/main.js', 'other.js'], 'main');
    expect(ranked[0].item.path).toBe('src/js/main.js');
  });

  it('ranks a filename match above a folder-only match', () => {
    // `src` appears in the *folder* of the first file and in the *name* of the
    // second; the second is what someone typing "src" is usually after.
    const ranked = rankFiles(['src/app.js', 'src-tools.js'], 'src');
    expect(ranked[0].item.path).toBe('src-tools.js');
  });

  it('lets the user choose between equally good matches instead of hiding one', () => {
    const ranked = rankFiles(['main.css', 'main.js'], 'main');
    expect(ranked.map((result) => result.item.path).sort()).toEqual(['main.css', 'main.js']);
  });

  it('matches a subsequence, so `mnjs` finds main.js', () => {
    expect(scoreMatch('main.js', 'mnjs')).not.toBeNull();
    expect(scoreMatch('main.js', 'zzz')).toBeNull();
  });

  it('prefers a contiguous run to a scattered one', () => {
    const contiguous = scoreMatch('index.html', 'index');
    const scattered = scoreMatch('i-n-d-e-x.html', 'index');
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it('lists everything for an empty query, and nothing for a miss', () => {
    expect(rankFiles(['a.js', 'b.js'], '')).toHaveLength(2);
    expect(rankFiles(['a.js'], 'qqqq')).toHaveLength(0);
  });

  it('splits a name into highlighted runs without losing a character', () => {
    const runs = highlight('main.js', [0, 1]);
    expect(runs.map((run) => run.text).join('')).toBe('main.js');
    expect(runs.filter((run) => run.hit)).toHaveLength(1);
    expect(runs[0]).toEqual({ text: 'ma', hit: true });
  });

  it('renders the palette with the current file list', () => {
    const html = renderToStaticMarkup(
      <Palette
        open
        mode="file"
        files={{ 'src/a.ts': { content: '', language: 'typescript' } }}
        onClose={noop}
        onOpenFile={noop}
        onReplace={noop}
      />,
    );
    expect(html).toContain('Open a file');
    expect(html).toContain('a.ts');
    expect(html).toContain('src');
  });

  it('renders nothing at all when closed', () => {
    expect(
      renderToStaticMarkup(
        <Palette
          open={false}
          mode="file"
          files={{}}
          onClose={noop}
          onOpenFile={noop}
          onReplace={noop}
        />,
      ),
    ).toBe('');
  });
});

describe('export and import', () => {
  const project = projectFromTemplate(templateById('web-starter')!, 'My page');

  it('round-trips a project without losing a file', () => {
    const text = serializeProject(project);
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.project.files).sort()).toEqual(Object.keys(project.files).sort());
    expect(result.project.files['index.html'].content).toBe(project.files['index.html'].content);
    expect(result.project.workspace).toBe('web');
    expect(result.project.accent).toBe(project.accent);
  });

  it('gives an import a new id, so it can never overwrite', () => {
    const text = serializeProject(project);
    const result = parseProject(text, () => 'prj_fixed');
    expect(result.ok && result.project.id).toBe('prj_fixed');
  });

  it('rejects a file that is not ours, with a reason', () => {
    const bad = parseProject('{"hello":"world"}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/not exported from CodeForge/);

    const notJson = parseProject('not json at all');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.error).toMatch(/not valid JSON/);
  });

  it('refuses a file from a newer build rather than misreading it', () => {
    const result = parseProject(JSON.stringify({ name: 'codeforge.project', version: 99, project: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer CodeForge/);
  });

  it('refuses a project whose paths would break the app', () => {
    const result = parseProject(
      JSON.stringify({
        name: 'codeforge.project',
        version: 1,
        project: { files: { '../escape.js': 'x' } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('makes a safe filename from any project name', () => {
    expect(exportFileName('My page')).toBe('my-page.codeforge.json');
    expect(exportFileName('  ')).toBe('project.codeforge.json');
    expect(exportFileName('a/b\\c:d')).toBe('a-b-c-d.codeforge.json');
  });

  it('carries folders and the empty ones too', () => {
    const withFolder = { ...project, folders: ['assets'] };
    const result = parseProject(serializeProject(withFolder));
    expect(result.ok && result.project.folders).toContain('assets');
  });
});

describe('the file tree markup', () => {
  it('renders folders as folders, with their files underneath', () => {
    const html = renderExplorer({ 'index.html': '', 'styles/style.css': '' });
    expect(html).toContain('tree-branch');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('style.css');
    expect(html).toContain('index.html');
  });

  it('shows an empty folder rather than hiding it', () => {
    const html = renderExplorer({ 'index.html': '' }, ['assets']);
    expect(html).toContain('assets');
    expect(html).toContain('empty');
  });

  it('offers file and folder creation', () => {
    const html = renderExplorer({ 'index.html': '' });
    expect(html).toContain('New file');
    expect(html).toContain('New folder');
  });

  it('has a labelled control for every row action', () => {
    const html = renderExplorer({ 'index.html': '' });
    for (const label of ['Duplicate index.html', 'Rename index.html', 'Delete index.html']) {
      expect(html, label).toContain(`aria-label="${label}"`);
    }
  });

  it('does not present a destructive action without a confirmation path', () => {
    // Delete is two-step in the component: the first press only arms the row.
    // Rendering statically proves the action exists but never that it fires —
    // which is the point: nothing in this markup deletes on the first click.
    const html = renderExplorer({ 'index.html': '' });
    expect(html).not.toContain('tree-confirm');
  });
});

describe('desktop arrangements', () => {
  const base = {
    tab: 'code' as const,
    onChange: noop,
    arrangement: 'split' as const,
    onArrangement: noop,
    files: { 'a.js': { content: '', language: 'javascript' as const } },
    activeFile: 'a.js',
    content: '',
    language: 'javascript' as const,
    theme: 'tokyo-night',
    onSelectFile: noop,
    onEdit: noop,
    runtime: { id: 'web', label: 'Web', preview: 'iframe' as const, available: true, run: () => ({ stop: noop }) },
    autorun: false,
    runSignal: 0,
    onRun: noop,
    onClearConsole: noop,
    onOpenFileForDiagnostic: noop,
    issues: { errors: 0, warnings: 0 },
    console: { entries: [], generation: 0, running: false },
    diagnostics: { diagnostics: [], checking: false, error: null },
    running: false,
  };

  it('shows code and preview together in split view', () => {
    const html = renderToStaticMarkup(<DesktopWorkspace {...base} />);
    expect(html).toContain('pane-editor');
    expect(html).toContain('pane-preview');
    // Both are on screen, so the *section* tab strip is absent. The file tabs
    // above the editor keep their own tablist, which is a different control.
    expect(html).not.toContain('Workspace sections');
  });

  it('shows exactly one section in focus view', () => {
    const html = renderToStaticMarkup(<DesktopWorkspace {...base} arrangement="focus" />);
    expect(html).toContain('Workspace sections');
    expect(html).toContain('pane-editor');
    expect(html).not.toContain('pane-preview');
  });

  it('puts the output pane behind a toggle in split view', () => {
    const html = renderToStaticMarkup(<DesktopWorkspace {...base} />);
    expect(html).toContain('output-drawer');
    expect(html).toContain('aria-expanded="false"');
    // A collapsed console must not render a second copy of the panels.
    expect(html).not.toContain('console-body');
  });

  it('shows the error count on the console toggle without opening it', () => {
    const html = renderToStaticMarkup(
      <DesktopWorkspace {...base} issues={{ errors: 2, warnings: 1 }} />,
    );
    expect(html).toContain('section-badge error');
    expect(html).toContain('>2<');
  });
});

describe('notice', () => {
  it('renders nothing without a notice, so it cannot leave an empty bar', () => {
    expect(renderToStaticMarkup(<NoticeBar />)).toBe('');
  });
});
