/**
 * Web workspace runtime.
 *
 * Assembles the project's files into one iframe `srcdoc` and instruments it so
 * `console.*` and uncaught errors reach the CodeForge console panel.
 *
 * Because every script is inlined into one document, the browser reports error
 * line numbers relative to the *document*. We therefore record the line span of
 * each inlined script and map document positions back to `file:line`.
 */
import type {
  FileMap,
  IOBridge,
  PreviewEvent,
  PreviewPayload,
  RunHandle,
  Runtime,
} from '../core/types';
import { lintFiles } from '../core/lint';

/** Line span occupied by one inlined `<script data-cf-file="…">` block. */
export interface ScriptSpan {
  file: string;
  /** 1-based first line of the script *body* (the tag itself is excluded). */
  startLine: number;
  /** 1-based last line of the script body. */
  endLine: number;
}

export interface BuiltDocument {
  srcdoc: string;
  scripts: ScriptSpan[];
}

/** Marks each inlined block so spans can be recovered by scanning the output. */
export const FILE_ATTR = 'data-cf-file';

/** Injected before user code so early logs are not missed. */
export const INSTRUMENT_SHIM = `(function () {
  var post = function (payload) {
    try { parent.postMessage(Object.assign({ __codeforge: 1 }, payload), "*"); } catch (e) {}
  };
  var seen = new WeakSet();
  var fmt = function (value) {
    if (value === null) return "null";
    var t = typeof value;
    if (t === "undefined") return "undefined";
    if (t === "string") return value;
    if (t === "number" || t === "boolean" || t === "bigint") return String(value);
    if (t === "function") return "function " + (value.name || "anonymous") + "()";
    if (t === "symbol") return value.toString();
    if (value instanceof Error) return value.name + ": " + value.message;
    try {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return JSON.stringify(value, function (_k, v) {
        if (typeof v === "bigint") return String(v);
        if (v instanceof Error) return v.name + ": " + v.message;
        return v;
      });
    } catch (e) { return String(value); }
  };
  ["log", "info", "warn", "error"].forEach(function (kind) {
    var orig = console[kind] ? console[kind].bind(console) : function () {};
    console[kind] = function () {
      var args = Array.prototype.slice.call(arguments);
      post({ type: "console", kind: kind, text: args.map(fmt).join(" ") });
      orig.apply(console, arguments);
    };
  });
  var origClear = console.clear ? console.clear.bind(console) : function () {};
  console.clear = function () { post({ type: "clear" }); origClear(); };
  window.addEventListener("error", function (ev) {
    post({
      type: "error",
      message: ev.message || "Uncaught error",
      line: ev.lineno, column: ev.colno,
      stack: ev.error && ev.error.stack ? String(ev.error.stack) : undefined
    });
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev.reason;
    post({
      type: "error",
      message: "Unhandled promise rejection: " + (r && r.message ? r.message : String(r)),
      stack: r && r.stack ? String(r.stack) : undefined
    });
  });
  post({ type: "ready" });
})();`;

function escapeForInlineScript(code: string): string {
  // A literal </script inside inlined code would close the tag early.
  return code.replace(/<\/script/gi, '<\\/script');
}

function normalizeRef(ref: string): string {
  return ref.trim().replace(/^\.?\//, '').replace(/^\/+/, '').split(/[?#]/)[0];
}

function findFile(files: FileMap, ref: string): string | undefined {
  const target = normalizeRef(ref).toLowerCase();
  if (!target) return undefined;
  for (const path of Object.keys(files)) {
    if (path.toLowerCase() === target) return path;
  }
  return undefined;
}

function filesByLanguage(files: FileMap, language: string): string[] {
  return Object.keys(files)
    .filter((p) => files[p].language === language)
    .sort();
}

/**
 * Drop trailing newlines so a block's body is exactly the file's lines and the
 * closing tag lands on its own line. This keeps span bookkeeping exact.
 */
function trimTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, '');
}

function cssBlock(path: string, css: string): string {
  return `<style ${FILE_ATTR}="${path}">\n${trimTrailingNewlines(css)}\n</style>`;
}

function scriptBlock(path: string, js: string): string {
  const body = trimTrailingNewlines(escapeForInlineScript(js));
  return `<script ${FILE_ATTR}="${path}">\n${body}\n</script>`;
}

function pickHtmlFile(files: FileMap): string | undefined {
  const html = filesByLanguage(files, 'html');
  if (html.length === 0) return undefined;
  return html.find((p) => p.toLowerCase() === 'index.html') ?? html[0];
}

/**
 * Recovers the line span of each inlined script by scanning the assembled
 * document. Scanning the real output (rather than trusting assembly bookkeeping)
 * keeps the mapping correct even if assembly changes.
 */
export function computeScriptSpans(srcdoc: string): ScriptSpan[] {
  const lines = srcdoc.split('\n');
  const spans: ScriptSpan[] = [];
  const openRe = new RegExp(`<script\\b[^>]*${FILE_ATTR}="([^"]+)"`);
  let open: { file: string; start: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A single line can close one block and open the next, so scan by position
    // rather than treating a line as either an opener or a closer.
    let cursor = 0;
    for (;;) {
      if (open) {
        const closeIdx = line.indexOf('</script>', cursor);
        if (closeIdx === -1) break;
        // `i` is 0-based, which equals the 1-based number of the line above —
        // i.e. the last line of this block's body.
        spans.push({ file: open.file, startLine: open.start, endLine: i });
        open = null;
        cursor = closeIdx + '</script>'.length;
        continue;
      }
      const m = openRe.exec(line.slice(cursor));
      if (!m || m.index === undefined) break;
      // The body begins on the following line: the tag sits on its own line.
      open = { file: m[1], start: i + 2 };
      cursor += m.index + m[0].length;
    }
  }
  return spans;
}

export interface MappedPosition {
  file: string;
  line: number;
  column: number;
}

/** Document-relative position (what the browser reports) → file-relative. */
export function mapDocumentPosition(
  scripts: ScriptSpan[],
  line: number | undefined,
  column: number | undefined,
): MappedPosition | null {
  if (typeof line !== 'number' || !Number.isFinite(line)) return null;
  for (const s of scripts) {
    if (line >= s.startLine && line <= s.endLine) {
      return { file: s.file, line: line - s.startLine + 1, column: column ?? 0 };
    }
  }
  return null;
}

/** Assemble every project file into a single self-contained document. */
export function buildWebDocument(files: FileMap): BuiltDocument {
  const htmlPath = pickHtmlFile(files);
  const used = new Set<string>();
  let doc = htmlPath ? files[htmlPath].content : '';
  if (htmlPath) used.add(htmlPath);

  // 1. Inline referenced stylesheets in place, preserving author order.
  doc = doc.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) return tag;
    const path = findFile(files, href);
    if (!path) return tag;
    used.add(path);
    return cssBlock(path, files[path].content);
  });

  // 2. Inline referenced scripts in place.
  doc = doc.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs: string) => {
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!src) return tag;
    const path = findFile(files, src);
    if (!path) return tag;
    used.add(path);
    return scriptBlock(path, files[path].content);
  });

  // 3. The instrument shim must run before any user code.
  const shim = `<script ${FILE_ATTR}="__codeforge_shim__">\n${INSTRUMENT_SHIM}\n</script>`;
  if (/<head[^>]*>/i.test(doc)) {
    doc = doc.replace(/<head[^>]*>/i, (tag) => `${tag}\n${shim}`);
  } else if (/<html[^>]*>/i.test(doc)) {
    doc = doc.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>\n${shim}\n</head>`);
  } else {
    doc = `<!doctype html>\n<html>\n<head>\n${shim}\n</head>\n<body>\n${doc}\n</body>\n</html>`;
  }

  // 4. Anything not referenced still gets included, so a stray file is never silent.
  const extraCss = filesByLanguage(files, 'css').filter((p) => !used.has(p));
  const extraJs = filesByLanguage(files, 'javascript').filter((p) => !used.has(p));

  const headExtra = extraCss.map((p) => cssBlock(p, files[p].content)).join('\n');
  const bodyExtra = extraJs.map((p) => scriptBlock(p, files[p].content)).join('\n');

  if (headExtra) {
    doc = /<\/head>/i.test(doc)
      ? doc.replace(/<\/head>/i, `${headExtra}\n</head>`)
      : `${headExtra}\n${doc}`;
  }
  if (bodyExtra) {
    doc = /<\/body>/i.test(doc)
      ? doc.replace(/<\/body>/i, `${bodyExtra}\n</body>`)
      : `${doc}\n${bodyExtra}`;
  }

  const scripts = computeScriptSpans(doc).filter((s) => s.file !== '__codeforge_shim__');
  return { srcdoc: doc, scripts };
}

export const webRuntime: Runtime = {
  id: 'web',
  label: 'Web',
  preview: 'iframe',
  available: true,

  lint(files: FileMap) {
    return Promise.resolve(lintFiles(files));
  },

  run(_files, _entry, bridge: IOBridge): RunHandle {
    bridge.log({ kind: 'system', text: 'Preview rebuilt. Console output is captured below.' });
    // The iframe is declarative; there is no process to stop.
    return { stop() {} };
  },

  buildPreview(files: FileMap): PreviewPayload {
    const { srcdoc, scripts } = buildWebDocument(files);
    // Carry the spans so handlePreviewMessage can map document lines back to files.
    return { kind: 'srcdoc', srcdoc, meta: { scripts } };
  },

  handlePreviewMessage(data: unknown, meta: unknown): PreviewEvent | null {
    if (typeof data !== 'object' || data === null) return null;
    const msg = data as Record<string, unknown>;
    if (msg.__codeforge !== 1) return null;

    if (msg.type === 'clear') return { type: 'clear' };

    if (msg.type === 'console') {
      const kind = msg.kind;
      return {
        type: 'log',
        entry: {
          kind:
            kind === 'log' || kind === 'info' || kind === 'warn' || kind === 'error'
              ? kind
              : 'log',
          text: String(msg.text ?? ''),
        },
      };
    }

    if (msg.type === 'error') {
      const spans = (meta as { scripts?: ScriptSpan[] } | undefined)?.scripts ?? [];
      const mapped = mapDocumentPosition(
        spans,
        typeof msg.line === 'number' ? msg.line : undefined,
        typeof msg.column === 'number' ? msg.column : undefined,
      );
      const stack = typeof msg.stack === 'string' ? msg.stack : undefined;
      const message = String(msg.message ?? 'Uncaught error');
      const location = mapped ? ` (${mapped.file}:${mapped.line})` : '';
      const text = stack ? `${message}${location}\n${stack}` : `${message}${location}`;
      return {
        type: 'log',
        entry: {
          kind: 'error',
          text,
          file: mapped?.file,
          line: mapped?.line,
          column: mapped?.column,
        },
      };
    }

    return null;
  },
};
