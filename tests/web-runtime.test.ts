import { describe, expect, it } from 'vitest';
import {
  FILE_ATTR,
  INSTRUMENT_SHIM,
  buildWebDocument,
  computeScriptSpans,
  mapDocumentPosition,
  webRuntime,
} from '../src/runtimes/web';
import { filesFromRecords } from '../src/core/templates';
import type { ConsoleKind } from '../src/core/types';

const FILES = filesFromRecords({
  'index.html': `<!doctype html>
<html>
  <head>
    <title>t</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>hi</h1>
    <script src="main.js"></script>
  </body>
</html>
`,
  'style.css': `body { margin: 0; }
h1 { color: red; }
`,
  'main.js': `console.log("line one");
const x = 1;
notDefinedAnywhere.go();
`,
});

describe('buildWebDocument', () => {
  it('inlines the stylesheet where the <link> was', () => {
    const { srcdoc } = buildWebDocument(FILES);
    expect(srcdoc).not.toContain('<link rel="stylesheet"');
    expect(srcdoc).toContain(`<style ${FILE_ATTR}="style.css">`);
    expect(srcdoc).toContain('h1 { color: red; }');
  });

  it('inlines the script where the <script src> was', () => {
    const { srcdoc } = buildWebDocument(FILES);
    expect(srcdoc).not.toContain('<script src="main.js">');
    expect(srcdoc).toContain(`<script ${FILE_ATTR}="main.js">`);
    expect(srcdoc).toContain('notDefinedAnywhere.go();');
  });

  it('injects the instrument shim before any user script', () => {
    const { srcdoc } = buildWebDocument(FILES);
    const shimAt = srcdoc.indexOf('__codeforge_shim__');
    const userAt = srcdoc.indexOf(`${FILE_ATTR}="main.js"`);
    expect(shimAt).toBeGreaterThan(-1);
    expect(userAt).toBeGreaterThan(-1);
    expect(shimAt).toBeLessThan(userAt);
  });

  it('keeps the shim content intact in the document', () => {
    const { srcdoc } = buildWebDocument(FILES);
    expect(srcdoc).toContain('addEventListener("error"');
    expect(srcdoc).toContain('parent.postMessage');
    expect(INSTRUMENT_SHIM.length).toBeGreaterThan(200);
  });

  it('synthesizes a document when there is no HTML file', () => {
    const { srcdoc } = buildWebDocument(filesFromRecords({ 'a.js': 'console.log(1);' }));
    expect(srcdoc).toMatch(/^<!doctype html>/i);
    expect(srcdoc).toContain('<head>');
    expect(srcdoc).toContain(`${FILE_ATTR}="a.js"`);
    expect(srcdoc).toContain('</body>');
  });

  it('still includes a stylesheet nobody referenced', () => {
    const { srcdoc } = buildWebDocument(
      filesFromRecords({ 'index.html': '<html><head></head><body></body></html>', 'orphan.css': 'a{b:c}' }),
    );
    expect(srcdoc).toContain(`${FILE_ATTR}="orphan.css"`);
    expect(srcdoc).toContain('a{b:c}');
  });

  it('matches a reference written with a leading ./', () => {
    const { srcdoc } = buildWebDocument(
      filesFromRecords({
        'index.html': '<html><head></head><body><script src="./app.js"></script></body></html>',
        'app.js': 'console.log("via dot-slash");',
      }),
    );
    expect(srcdoc).toContain(`${FILE_ATTR}="app.js"`);
    expect(srcdoc).toContain('via dot-slash');
  });

  it('leaves an unknown external reference alone', () => {
    const { srcdoc } = buildWebDocument(
      filesFromRecords({
        'index.html':
          '<html><head></head><body><script src="https://cdn.example/lib.js"></script></body></html>',
      }),
    );
    expect(srcdoc).toContain('https://cdn.example/lib.js');
    expect(srcdoc).not.toContain(`${FILE_ATTR}="https`);
  });

  it('does not let a literal </script> in user code close the tag early', () => {
    const { srcdoc, scripts } = buildWebDocument(
      filesFromRecords({
        'index.html': '<html><head></head><body><script src="tricky.js"></script></body></html>',
        // The naive version of this breaks every inline-script bundler.
        'tricky.js': 'const html = "</script>";\nconsole.log(html);',
      }),
    );
    expect(srcdoc).toContain('<\\/script>');
    // The span must still close at the real tag, not the one inside the string.
    expect(scripts).toHaveLength(1);
    expect(scripts[0].file).toBe('tricky.js');
  });
});

describe('computeScriptSpans / mapDocumentPosition', () => {
  it('span lines reproduce the original file content exactly', () => {
    const { srcdoc, scripts } = buildWebDocument(FILES);
    const lines = srcdoc.split('\n');
    const main = scripts.find((s) => s.file === 'main.js');
    expect(main).toBeDefined();
    const body = lines.slice(main!.startLine - 1, main!.endLine);
    expect(body.join('\n')).toBe(FILES['main.js'].content.trimEnd());
  });

  it('excludes the shim from the spans it reports', () => {
    const { scripts } = buildWebDocument(FILES);
    expect(scripts.map((s) => s.file)).toEqual(['main.js']);
  });

  it('maps a document line back to the originating file line', () => {
    const { scripts } = buildWebDocument(FILES);
    const main = scripts.find((s) => s.file === 'main.js')!;
    // The browser reports document-relative lines. Line 3 of main.js is the throw.
    const mapped = mapDocumentPosition(scripts, main.startLine + 2, 5);
    expect(mapped).toEqual({ file: 'main.js', line: 3, column: 5 });
  });

  it('maps every line of the script consistently', () => {
    const { scripts } = buildWebDocument(FILES);
    const main = scripts.find((s) => s.file === 'main.js')!;
    for (let i = 0; i < 3; i++) {
      expect(mapDocumentPosition(scripts, main.startLine + i, 0)).toEqual({
        file: 'main.js',
        line: i + 1,
        column: 0,
      });
    }
  });

  it('returns null for a line outside any script', () => {
    const { scripts } = buildWebDocument(FILES);
    expect(mapDocumentPosition(scripts, 1, 1)).toBeNull();
    expect(mapDocumentPosition(scripts, undefined, undefined)).toBeNull();
  });

  it('distinguishes two separate scripts', () => {
    const { scripts } = buildWebDocument(
      filesFromRecords({
        'index.html':
          '<html><head></head><body><script src="a.js"></script><script src="b.js"></script></body></html>',
        'a.js': 'const a = 1;\nconst a2 = 2;\n',
        'b.js': 'const b = 1;\n',
      }),
    );
    expect(scripts).toHaveLength(2);
    const [a, b] = scripts;
    expect(mapDocumentPosition(scripts, a.startLine, 0)?.file).toBe('a.js');
    expect(mapDocumentPosition(scripts, b.startLine, 0)).toEqual({ file: 'b.js', line: 1, column: 0 });
  });

  it('computeScriptSpans ignores an unmarked script', () => {
    const spans = computeScriptSpans('<script>\nplain();\n</script>');
    expect(spans).toEqual([]);
  });
});

describe('webRuntime.handlePreviewMessage', () => {
  const meta = { scripts: buildWebDocument(FILES).scripts };

  it('ignores messages that are not from the shim', () => {
    expect(webRuntime.handlePreviewMessage!({ hello: 1 }, meta)).toBeNull();
    expect(webRuntime.handlePreviewMessage!(null, meta)).toBeNull();
    expect(webRuntime.handlePreviewMessage!('text', meta)).toBeNull();
  });

  it('forwards console output with its kind', () => {
    const kinds: ConsoleKind[] = ['log', 'info', 'warn', 'error'];
    for (const kind of kinds) {
      const event = webRuntime.handlePreviewMessage!({ __codeforge: 1, type: 'console', kind, text: 'x' }, meta);
      expect(event).toEqual({ type: 'log', entry: { kind, text: 'x' } });
    }
  });

  it('falls back to log for an unknown console kind', () => {
    const event = webRuntime.handlePreviewMessage!(
      { __codeforge: 1, type: 'console', kind: 'table', text: 'x' },
      meta,
    );
    expect(event?.type === 'log' && event.entry.kind).toBe('log');
  });

  it('translates a clear message', () => {
    expect(webRuntime.handlePreviewMessage!({ __codeforge: 1, type: 'clear' }, meta)).toEqual({
      type: 'clear',
    });
  });

  it('attaches file and line to an uncaught error', () => {
    const main = meta.scripts.find((s) => s.file === 'main.js')!;
    const event = webRuntime.handlePreviewMessage!(
      {
        __codeforge: 1,
        type: 'error',
        message: 'notDefinedAnywhere is not defined',
        line: main.startLine + 2,
        column: 1,
      },
      meta,
    );
    expect(event?.type).toBe('log');
    if (event?.type !== 'log') throw new Error('expected a log event');
    expect(event.entry.kind).toBe('error');
    expect(event.entry.file).toBe('main.js');
    expect(event.entry.line).toBe(3);
    expect(event.entry.text).toContain('main.js:3');
  });

  it('reports an error without a line rather than guessing one', () => {
    const event = webRuntime.handlePreviewMessage!(
      { __codeforge: 1, type: 'error', message: 'boom' },
      meta,
    );
    if (event?.type !== 'log') throw new Error('expected a log event');
    expect(event.entry.file).toBeUndefined();
    expect(event.entry.text).toBe('boom');
  });

  it('includes the stack when the browser sent one', () => {
    const event = webRuntime.handlePreviewMessage!(
      { __codeforge: 1, type: 'error', message: 'boom', stack: 'Error: boom\n at a.js:1' },
      meta,
    );
    if (event?.type !== 'log') throw new Error('expected a log event');
    expect(event.entry.text).toContain('at a.js:1');
  });
});

describe('webRuntime.buildPreview', () => {
  it('returns a srcdoc payload carrying the spans', () => {
    const payload = webRuntime.buildPreview!(FILES);
    expect(payload.kind).toBe('srcdoc');
    if (payload.kind !== 'srcdoc') throw new Error('expected srcdoc');
    expect(payload.srcdoc).toContain('<h1>hi</h1>');
    expect((payload.meta as { scripts: unknown[] }).scripts).toHaveLength(1);
  });
});
