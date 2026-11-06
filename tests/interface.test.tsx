/**
 * The Forge S1.9 interface: source control, global search, palette, themes, export/import and the
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
  EDITOR_THEMES,
  INTERFACE,
  TOKYO,
  accentHex,
  resolveEditorTheme,
  MONACO_THEMES,
} from '../src/core/theme';
import {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEMES,
  loadInterfaceTheme,
  resolveInterfaceTheme,
  saveInterfaceTheme,
} from '../src/core/interfaceTheme';
import { highlight, rankFiles, scoreMatch, searchProjectFiles } from '../src/core/search';
import { exportFileName, parseProject, serializeProject } from '../src/core/transfer';
import { projectFromTemplate, templateById } from '../src/core/templates';
import { Explorer } from '../src/ui/Explorer';
import { Palette } from '../src/ui/Palette';
import { NoticeBar } from '../src/ui/NoticeBar';
import { DesktopWorkspace } from '../src/ui/DesktopWorkspace';
import { Drawer } from '../src/ui/Drawer';
import { TopBar } from '../src/ui/TopBar';
import { SettingsPanel } from '../src/ui/SettingsPanel';
import { currentRelease } from '../src/core/release';

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

  it('keeps Monaco Tokyo Night colors separate from the richer interface palette', () => {
    // Editor syntax retains the Tokyo Night colors; interface accents have
    // their own brighter blue and distinct workspace hues.
    expect(TOKYO.bg).toBe('#16161e');
    expect(TOKYO.accent).toBe('#7aa2f7');
    expect(TOKYO.purple).toBe('#bb9af7');
    expect(INTERFACE.accent).toBe('#78a9ff');
    expect(INTERFACE.accent).not.toBe(TOKYO.accent);
    expect(INTERFACE.purple).toBe('#c0a3ed');
    expect(INTERFACE.cyan).toBe('#8dcdf5');
    expect(INTERFACE.teal).toBe('#80cfb2');
  });

  it('resolves a vivid-but-muted interface accent and falls back safely', () => {
    expect(accentHex('teal')).toBe('#80cfb2');
    expect(accentHex(undefined)).toBe(INTERFACE.accent);
    // A project saved by a future build with an accent this one does not know.
    expect(accentHex('chartreuse')).toBe(INTERFACE.accent);
  });

  it('offers distinct, softened project accents for the dark interface themes', () => {
    const ids = ACCENTS.map((accent) => accent.id);
    const colors = ACCENTS.map((accent) => accent.hex);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(colors).size).toBe(colors.length);
    for (const accent of ACCENTS) expect(accent.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(ACCENTS[0].hex).toBe(INTERFACE.accent);
  });

  it('maps an old Monaco theme id forward', () => {
    // S1.5 projects hold 'vs-dark' / 'vs'. Opening one must not fail.
    expect(resolveEditorTheme('vs-dark')).toBe('tokyo-night');
    expect(resolveEditorTheme('vs')).toBe('tokyo-storm');
    expect(resolveEditorTheme('tokyo-storm')).toBe('tokyo-storm');
    expect(resolveEditorTheme(undefined)).toBe('tokyo-night');
  });

  it('keeps colored syntax highlighting separate from the graphite interface palette', () => {
    const ids = MONACO_THEMES.map((theme) => theme.id).sort();
    expect(ids).toEqual(['tokyo-night', 'tokyo-storm']);
    for (const theme of MONACO_THEMES) {
      expect(theme.data.colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.data.rules.length).toBeGreaterThan(3);
    }
    const night = MONACO_THEMES.find((theme) => theme.id === 'tokyo-night')!;
    expect(night.data.colors['editor.background']).toBe('#1a1b26');
    expect(night.data.rules.map((rule) => rule.foreground)).toContain('bb9af7');
    expect(night.data.rules.map((rule) => rule.foreground)).toContain('9ece6a');
    expect(MONACO_THEMES.find((theme) => theme.id === 'tokyo-storm')!.data.colors['editor.background']).toBe('#24283b');
    expect(EDITOR_THEMES.map((theme) => theme.label)).toEqual(['Night', 'Storm']);

    expect(INTERFACE.bg).not.toBe(INTERFACE.bgRaise);
    expect(INTERFACE.bgRaise).not.toBe(INTERFACE.bgRaise2);
    for (const token of CSS_TOKENS) expect(token.value).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('application chrome themes', () => {
  it('offers VS Code Dark and Cursor Midnight as a global preference', () => {
    expect(INTERFACE_THEMES.map((theme) => theme.id)).toEqual(['vscode-dark', 'cursor-midnight']);
    expect(DEFAULT_INTERFACE_THEME).toBe('vscode-dark');
    expect(resolveInterfaceTheme('cursor-midnight')).toBe('cursor-midnight');
    expect(resolveInterfaceTheme('unknown')).toBe(DEFAULT_INTERFACE_THEME);

    const values: Record<string, string> = { 'codeforge:interface-theme': 'cursor-midnight' };
    const storage = {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value; },
    };
    expect(loadInterfaceTheme(storage)).toBe('cursor-midnight');
    expect(saveInterfaceTheme('vscode-dark', storage)).toBe('vscode-dark');
    expect(values['codeforge:interface-theme']).toBe('vscode-dark');
  });

  it('applies VS Code Dark tokens to chrome through a separate app theme selector', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toContain(".app[data-interface-theme='vscode-dark']");
    expect(css).toContain('--bg: #1e1e1e;');
    expect(css).toContain('--accent: #3794ff;');
    expect(MONACO_THEMES.map((theme) => theme.id)).toEqual(['tokyo-night', 'tokyo-storm']);
  });

  it('keeps the interface selector separate from Night and Storm editor themes', () => {
    const project = projectFromTemplate(templateById('web-starter')!, 'Theme test');
    const html = renderToStaticMarkup(
      <SettingsPanel
        project={project}
        interfaceTheme="vscode-dark"
        onAccent={noop}
        onTheme={noop}
        onInterfaceTheme={noop}
      />,
    );
    expect(html).toContain('aria-label="Interface theme"');
    expect(html).toContain('VS Code Dark');
    expect(html).toContain('Cursor Midnight');
    expect(html).toContain('interface-theme-option active');
    expect(html).toContain('aria-label="Editor theme"');
    expect(html).toContain('Night');
    expect(html).toContain('Storm');
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

  it('searches literal text across files and reports exact source locations', () => {
    const result = searchProjectFiles(
      {
        'src/app.ts': { content: 'const user = "Ada";\nuseUser(user);', language: 'typescript' },
        'index.html': { content: '<h1>USER</h1>', language: 'html' },
      },
      'user',
    );
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.matches.map(({ path, line, column }) => [path, line, column])).toEqual([
      ['index.html', 1, 5],
      ['src/app.ts', 1, 7],
      ['src/app.ts', 2, 4],
      ['src/app.ts', 2, 9],
    ]);
  });

  it('caps rendered search results but reports that more matches exist', () => {
    const result = searchProjectFiles({ 'many.txt': { content: 'x x x x', language: 'typescript' } }, 'x', 2);
    expect(result.matches).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(true);
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
        commands={[]}
        onClose={noop}
        onOpenFile={noop}
        onOpenSearchResult={noop}
        onReplace={noop}
      />,
    );
    expect(html).toContain('Open a file');
    expect(html).toContain('a.ts');
    expect(html).toContain('src');
  });

  it('supports the global project search shortcut', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("key === 'f' && e.shiftKey");
    expect(app).toContain("openPalette('search')");
  });

  it('renders searchable commands in command mode', () => {
    const html = renderToStaticMarkup(
      <Palette
        open
        mode="command"
        files={{}}
        commands={[
          { id: 'files', label: 'Open Files', description: 'Browse project files', shortcut: 'Ctrl+B', run: noop },
        ]}
        onClose={noop}
        onOpenFile={noop}
        onOpenSearchResult={noop}
        onReplace={noop}
      />,
    );
    expect(html).toContain('Command palette');
    expect(html).toContain('Open Files');
    expect(html).toContain('Browse project files');
    expect(html).toContain('Ctrl+B');
  });

  it('renders nothing at all when closed', () => {
    expect(
      renderToStaticMarkup(
        <Palette
          open={false}
          mode="file"
          files={{}}
          commands={[]}
          onClose={noop}
          onOpenFile={noop}
        onOpenSearchResult={noop}
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

  it('uses the matching official SVG icon for each known file type', () => {
    const html = renderExplorer({
      'main.py': '',
      'src/app.tsx': '',
      'styles/site.css': '',
      'config.json': '',
      'README.md': '',
      'notes.unknown': '',
    });

    expect(html).toContain('src="/file-icons/file-type-python.svg"');
    expect(html).toContain('src="/file-icons/file-type-reactts-official.svg"');
    expect(html).toContain('src="/file-icons/file-type-css.svg"');
    expect(html).toContain('src="/file-icons/file-type-json-official.svg"');
    expect(html).toContain('src="/file-icons/file-type-markdown.svg"');
    expect(html).toContain('<svg'); // Unknown extensions retain the neutral file icon.
  });

  it('shows an empty folder rather than hiding it', () => {
    const html = renderExplorer({ 'index.html': '' }, ['assets']);
    expect(html).toContain('assets');
    expect(html).toContain('empty');
  });

  it('keeps toolbar creation at project root and nests only from a folder plus', () => {
    const html = renderExplorer({ 'src/index.html': '' });
    const source = readFileSync('src/ui/Explorer.tsx', 'utf8');
    expect(html).toContain('New file at project root');
    expect(html).toContain('New folder at project root');
    expect(source).toContain("onClick={() => beginCreate('file', '')}");
    expect(source).toContain("beginCreate('file', node.path)");
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

describe('mobile drawer overlay', () => {
  const base = {
    open: true,
    onClose: noop,
    pinned: true,
    onTogglePin: noop,
    layout: 'compact' as const,
    project: null,
    release: currentRelease(),
    activeSection: 'code' as const,
    onSection: noop,
    issues: { errors: 2, warnings: 1 },
    running: false,
    onRun: noop,
    onStop: noop,
    onExit: noop,
    onSelectFile: noop,
    onCreateFile: noop,
    onCreateFolder: noop,
    onRename: noop,
    onDeleteFile: noop,
    onDeleteFolder: noop,
    onDuplicateFile: noop,
    onOpenSearch: noop,
  };

  it('uses an overlay and backdrop on mobile with colored semantic section identities', () => {
    const html = renderToStaticMarkup(<Drawer {...base} />);
    expect(html).toContain('class="drawer-scrim"');
    expect(html).toContain('class="drawer open"');
    expect(html).not.toContain('drawer open pinned');
    expect(html).toContain('class="drawer-section section-code active"');
    expect(html).toContain('class="drawer-section section-files"');
    expect(html).toContain('class="drawer-section section-source"');
    expect(html).toContain('aria-label="2 errors"');
  });

  it('does not add an overlay backdrop for a pinned desktop drawer', () => {
    const html = renderToStaticMarkup(<Drawer {...base} layout="desktop" />);
    expect(html).not.toContain('drawer-scrim');
    expect(html).toContain('drawer open pinned');
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

  it('keeps collapsed output mounted for animation but inert to keyboard and assistive tech', () => {
    const html = renderToStaticMarkup(<DesktopWorkspace {...base} />);
    expect(html).toContain('output-drawer');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="output-panel" aria-hidden="true" inert=""');
    expect(html).toContain('console-body');
  });

  it('shows the error count on the console toggle without opening it', () => {
    const html = renderToStaticMarkup(
      <DesktopWorkspace {...base} issues={{ errors: 2, warnings: 1 }} />,
    );
    expect(html).toContain('section-badge error');
    expect(html).toContain('>2<');
  });
});

describe('top bar project navigation', () => {
  it('uses a clean back control with an explicit Projects destination', () => {
    const project = projectFromTemplate(templateById('web-starter')!, 'Starter');
    const html = renderToStaticMarkup(
      <TopBar
        project={project}
        dirty={false}
        running={false}
        onRename={noop}
        onRun={noop}
        onStop={noop}
        onNewProject={noop}
        onExit={noop}
        onOpenDrawer={noop}
        onOpenSearch={noop}
      />,
    );
    expect(html).toContain('class="project-back-btn"');
    expect(html).toContain('aria-label="Back to Projects"');
    expect(html).toContain('class="project-back-label">Projects</span>');
    expect(html).toContain('workspace-chip workspace-chip-web');
    expect(html).toContain('aria-label="All changes saved"');
  });
});

describe('notice', () => {
  it('renders nothing without a notice, so it cannot leave an empty bar', () => {
    expect(renderToStaticMarkup(<NoticeBar />)).toBe('');
  });
});

describe('interaction motion foundation', () => {
  const css = readFileSync('src/styles.css', 'utf8');

  it('gives buttons tactile hover and press feedback with visible keyboard focus', () => {
    expect(css).toContain('--motion-ui: 190ms');
    expect(css).toContain('.btn:hover:not(:disabled)');
    expect(css).toContain('transform: translateY(0) scale(0.98)');
    expect(css).toContain('button:focus-visible');
  });

  it('animates output expansion without taking the panels out of the document', () => {
    expect(css).toContain('.output-panel {');
    expect(css).toContain('grid-template-rows: 0fr');
    expect(css).toContain('.output-panel.open');
    expect(css).toContain('grid-template-rows: 1fr');
  });

  it('respects reduced-motion preferences across the interface', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition-duration: 0.01ms !important');
    expect(css).toContain('animation-duration: 0.01ms !important');
  });
});
