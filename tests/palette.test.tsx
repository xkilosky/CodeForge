// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Palette } from '../src/ui/Palette';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('command palette', () => {
  it('searches project text and opens the match at its source location', () => {
    const onClose = vi.fn();
    const onOpenSearchResult = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Palette
          open
          mode="search"
          files={{ 'src/app.ts': { content: 'const title = "Hello";', language: 'typescript' } }}
          commands={[]}
          onClose={onClose}
          onOpenFile={vi.fn()}
          onOpenSearchResult={onOpenSearchResult}
          onReplace={vi.fn()}
        />,
      );
    });

    const input = container.querySelector('input[aria-label="Search project text"]') as HTMLInputElement;
    act(() => changeInput(input, 'hello'));
    expect(container.textContent).toContain('src/app.ts');
    expect(container.textContent).toContain('Hello');

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onOpenSearchResult).toHaveBeenCalledWith({
      path: 'src/app.ts',
      line: 1,
      column: 16,
      length: 5,
      text: 'const title = "Hello";',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('switches from quick open with > and runs the selected command', () => {
    const onClose = vi.fn();
    const run = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Palette
          open
          mode="file"
          files={{}}
          commands={[
            {
              id: 'files',
              label: 'Open Files',
              description: 'Browse project files',
              run,
            },
          ]}
          onClose={onClose}
          onOpenFile={vi.fn()}
          onOpenSearchResult={vi.fn()}
          onReplace={vi.fn()}
        />,
      );
    });

    const input = container.querySelector('input[aria-label="File name"]') as HTMLInputElement;
    act(() => changeInput(input, '>Open Files'));
    expect(container.querySelector('[aria-label="Commands"]')).not.toBeNull();
    expect(container.textContent).toContain('Open Files');

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});
