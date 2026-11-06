import { describe, expect, it } from 'vitest';
import { getFileDiff } from '../src/core/diff';

describe('local file diffs', () => {
  it('detects edits against the project-open snapshot', () => {
    expect(
      getFileDiff(
        { 'src/app.ts': 'const value = 1;' },
        { 'src/app.ts': { content: 'const value = 2;', language: 'typescript' } },
        'src/app.ts',
      ),
    ).toEqual({ original: 'const value = 1;', modified: 'const value = 2;' });
  });

  it('uses empty content for newly added and deleted files', () => {
    expect(
      getFileDiff(
        {},
        { 'src/new.py': { content: 'print("hi")', language: 'python' } },
        'src/new.py',
      ),
    ).toEqual({ original: '', modified: 'print("hi")' });
    expect(
      getFileDiff(
        { 'src/gone.py': 'print("bye")' },
        {},
        'src/gone.py',
      ),
    ).toEqual({ original: 'print("bye")', modified: '' });
  });

  it('returns no diff when the file matches its snapshot', () => {
    expect(
      getFileDiff(
        { 'src/app.ts': 'same' },
        { 'src/app.ts': { content: 'same', language: 'typescript' } },
        'src/app.ts',
      ),
    ).toBeNull();
  });
});
