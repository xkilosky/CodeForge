import { describe, expect, it } from 'vitest';
import { lintFiles } from '../src/core/lint';
import type { FileMap } from '../src/core/types';

const sourceFile = (content: string, language: FileMap[string]['language']) => ({ content, language });

describe('live local lint', () => {
  it('finds unclosed HTML tags with file and source locations', () => {
    const diagnostics = lintFiles({ 'index.html': sourceFile('<main>\n<p>Hello</main>', 'html') });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      file: 'index.html',
      line: 2,
      severity: 'error',
      source: 'HTML',
      message: 'Missing closing tag for <p>.',
    }));
  });

  it('ignores tag-like text inside inline scripts and styles', () => {
    expect(lintFiles({
      'index.html': sourceFile(
        '<script>const markup = "<div>";</script><style>.card::after { content: "<p>"; }</style>',
        'html',
      ),
    })).toEqual([]);
  });

  it('finds unbalanced CSS braces but ignores braces inside strings and comments', () => {
    const diagnostics = lintFiles({
      'styles.css': sourceFile('a { content: "}"; /* { */', 'css'),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      file: 'styles.css',
      severity: 'error',
      source: 'CSS',
      message: 'Missing closing brace.',
    });
  });

  it('reports malformed JSON and leaves valid JSON clean', () => {
    expect(lintFiles({ 'data.json': sourceFile('{ "count": }', 'json') })).toMatchObject([
      { file: 'data.json', line: 1, severity: 'error', source: 'JSON' },
    ]);
    expect(lintFiles({ 'data.json': sourceFile('{ "count": 2 }', 'json') })).toEqual([]);
  });

  it('leaves JavaScript and TypeScript to Monaco’s compiler worker', () => {
    expect(lintFiles({
      'app.ts': sourceFile('const count: number = "wrong";', 'typescript'),
      'main.js': sourceFile('const count = ;', 'javascript'),
    })).toEqual([]);
  });
});
