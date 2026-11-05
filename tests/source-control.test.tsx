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
});
