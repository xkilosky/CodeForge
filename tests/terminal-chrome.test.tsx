import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Terminal as TerminalType } from '@xterm/xterm';
import { TerminalChrome } from '../src/ui/TerminalChrome';

const noop = () => {};

function renderChrome(shell: 'bash' | 'node'): string {
  return renderToStaticMarkup(
    <TerminalChrome
      shell={shell}
      status="ready"
      statusMessage="Shell ready"
      projectName="Demo project"
      activePath="src/main.js"
      serverUrl={null}
      terminalRef={createRef<TerminalType>()}
      terminalHostRef={createRef<HTMLDivElement>()}
      issues={[]}
      onSwitchShell={noop}
      onRunActiveFile={noop}
      onClear={noop}
      onRestart={noop}
      sendInput={noop}
      onStatusMessage={noop}
      onOpenIssue={noop}
    />,
  );
}

describe('terminal chrome', () => {
  it('offers both runtimes and touch-friendly terminal controls', () => {
    const markup = renderChrome('bash');
    expect(markup).toContain('Choose runtime in this terminal');
    expect(markup.match(/<h2>Terminal<\/h2>/g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Node / npm');
    expect(markup).toContain('Paste');
    expect(markup).toContain('Restart');
    expect(markup).toContain('Ctrl+C');
    expect(markup).toContain('previous command');
  });

  it('shows Node/npm shortcuts when that runtime is selected', () => {
    const markup = renderChrome('node');
    expect(markup).toContain('Browser runtime');
    expect(markup).toContain('node -v');
    expect(markup).toContain('npm -v');
  });
});
