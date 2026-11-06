// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/core/types';
import { SourceControlPanel } from '../src/ui/SourceControlPanel';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const project: Project = {
  id: 'project-1',
  name: 'Sample',
  workspace: 'web',
  files: { 'src/app.ts': { content: 'const value = 2;', language: 'typescript' } },
  activeFile: 'src/app.ts',
  settings: { theme: 'tokyo-night', autorun: false },
  sourceControl: {
    owner: 'octocat',
    repo: 'hello-world',
    branch: 'main',
    baseCommit: 'commit-1',
    baseTree: 'tree-1',
    baseFiles: { 'src/app.ts': 'const value = 1;' },
    staged: {},
  },
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('Source Control panel', () => {
  it('keeps the token entry masked and explains it is memory-only', () => {
    const onUpdate = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <SourceControlPanel
        project={project}
        onUpdate={onUpdate}
        onReplaceFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onViewDiff={vi.fn()}
      />,
    ));

    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.textContent).toContain('memory only');
    expect(container.textContent).toContain('Contents read/write');
  });

  it('stages a snapshot of the modified file', () => {
    const onUpdate = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <SourceControlPanel
        project={project}
        onUpdate={onUpdate}
        onReplaceFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onViewDiff={vi.fn()}
      />,
    ));

    const stageButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Stage',
    );
    expect(stageButton).toBeDefined();
    act(() => stageButton?.click());
    expect(onUpdate).toHaveBeenCalledWith({
      ...project.sourceControl,
      staged: { 'src/app.ts': 'const value = 2;' },
    });
  });

  it('opens a line diff for an edited file', () => {
    const onViewDiff = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <SourceControlPanel
        project={project}
        onUpdate={vi.fn()}
        onReplaceFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onViewDiff={onViewDiff}
      />,
    ));

    const diffButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="View diff for src/app.ts"]',
    );
    expect(diffButton).not.toBeNull();
    act(() => diffButton?.click());
    expect(onViewDiff).toHaveBeenCalledWith('src/app.ts', 'const value = 1;', 'const value = 2;');
  });

  it('keeps deleted files diffable even though they cannot open in the editor', () => {
    const onViewDiff = vi.fn();
    const deletedProject = { ...project, files: {}, activeFile: '' };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <SourceControlPanel
        project={deletedProject}
        onUpdate={vi.fn()}
        onReplaceFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onViewDiff={onViewDiff}
      />,
    ));

    const diffButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="View diff for src/app.ts"]',
    );
    expect(diffButton).not.toBeNull();
    act(() => diffButton?.click());
    expect(onViewDiff).toHaveBeenCalledWith('src/app.ts', 'const value = 1;', '');
  });

  it('diffs staged and unstaged edits against their correct snapshots', () => {
    const onViewDiff = vi.fn();
    const stagedProject = {
      ...project,
      files: { 'src/app.ts': { content: 'const value = 3;', language: 'typescript' as const } },
      sourceControl: {
        ...project.sourceControl!,
        staged: { 'src/app.ts': 'const value = 2;' },
      },
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <SourceControlPanel
        project={stagedProject}
        onUpdate={vi.fn()}
        onReplaceFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onViewDiff={onViewDiff}
      />,
    ));

    const diffButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="View diff for src/app.ts"]',
    );
    expect(diffButtons).toHaveLength(2);
    act(() => diffButtons[0].click());
    act(() => diffButtons[1].click());
    expect(onViewDiff.mock.calls).toEqual([
      ['src/app.ts', 'const value = 2;', 'const value = 3;'],
      ['src/app.ts', 'const value = 1;', 'const value = 2;'],
    ]);
  });

  it('uses an empty baseline for newly added files', () => {
    const onViewDiff = vi.fn();
    const addedProject = {
      ...project,
      files: {
        ...project.files,
        'src/new.py': { content: 'print("hello")', language: 'python' as const },
      },
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <SourceControlPanel
        project={addedProject}
        onUpdate={vi.fn()}
        onReplaceFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onViewDiff={onViewDiff}
      />,
    ));

    const diffButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="View diff for src/new.py"]',
    );
    expect(diffButton).not.toBeNull();
    act(() => diffButton?.click());
    expect(onViewDiff).toHaveBeenCalledWith('src/new.py', '', 'print("hello")');
  });

});
