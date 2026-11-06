import type { Diagnostic, FileMap } from './types';

const VOID_HTML_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

function diagnostic(
  file: string,
  content: string,
  offset: number,
  message: string,
  source: string,
): Diagnostic {
  const before = content.slice(0, Math.max(0, offset));
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return { file, line, column, severity: 'error', message, source };
}

function lintJson(path: string, content: string): Diagnostic[] {
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position\s+(\d+)/i.exec(message);
    const offset = position ? Number(position[1]) : 0;
    return [diagnostic(path, content, offset, message, 'JSON')];
  }
}

function lintHtml(path: string, content: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const stack: Array<{ tag: string; offset: number }> = [];
  const tags = /<!--(?:[\s\S]*?)-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = tags.exec(content))) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const tag = (match[1] ?? '').toLowerCase();
    if (!tag) continue;
    if (token.startsWith('</')) {
      const openIndex = stack.map((item) => item.tag).lastIndexOf(tag);
      if (openIndex < 0) {
        issues.push(diagnostic(path, content, match.index, `Unexpected closing tag </${tag}>.`, 'HTML'));
      } else {
        // A closer can close nested optional tags as HTML does, but flag an
        // intervening unclosed element so common authoring mistakes are visible.
        for (const unclosed of stack.slice(openIndex + 1).reverse()) {
          issues.push(diagnostic(path, content, unclosed.offset, `Missing closing tag for <${unclosed.tag}>.`, 'HTML'));
        }
        stack.length = openIndex;
      }
      continue;
    }
    if (!VOID_HTML_ELEMENTS.has(tag) && !/\/\s*>$/.test(token)) {
      stack.push({ tag, offset: match.index });
      // In HTML, script/style contents are raw text; strings such as "<div>"
      // inside a script must not be interpreted as document markup.
      if (tag === 'script' || tag === 'style') {
        const closingTag = new RegExp(`<\\/${tag}\\s*>`, 'ig');
        closingTag.lastIndex = tags.lastIndex;
        const closing = closingTag.exec(content);
        if (closing) tags.lastIndex = closing.index;
      }
    }
  }

  for (const item of stack.reverse()) {
    issues.push(diagnostic(path, content, item.offset, `Missing closing tag for <${item.tag}>.`, 'HTML'));
  }
  return issues;
}

function lintCss(path: string, content: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const stack: number[] = [];
  let quote = '';
  let comment = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '*') {
      comment = true;
      i++;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      stack.push(i);
    } else if (char === '}') {
      if (stack.length) stack.pop();
      else issues.push(diagnostic(path, content, i, 'Unexpected closing brace.', 'CSS'));
    }
  }

  for (const offset of stack) {
    issues.push(diagnostic(path, content, offset, 'Missing closing brace.', 'CSS'));
  }
  if (quote) issues.push(diagnostic(path, content, content.length, 'Unclosed string.', 'CSS'));
  return issues;
}

/** Fast, local checks for markup, styles, and JSON. JS/TS is checked by Monaco's TypeScript worker. */
export function lintFiles(files: FileMap): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [path, file] of Object.entries(files)) {
    switch (file.language) {
      case 'html':
        diagnostics.push(...lintHtml(path, file.content));
        break;
      case 'css':
        diagnostics.push(...lintCss(path, file.content));
        break;
      case 'json':
        diagnostics.push(...lintJson(path, file.content));
        break;
    }
  }
  return diagnostics;
}
