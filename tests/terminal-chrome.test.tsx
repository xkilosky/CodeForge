import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Terminal as TerminalType } from '@xterm/xterm';
import { TerminalChrome } from '../src/ui/TerminalChrome';

const noop = () => {};

function renderChrome(): string {
  return renderToStaticMarkup(
    <TerminalChrome
      status="ready"
      statusMessage="Shell ready"
      projectName="Demo project"
      activePath="src/main.js"
      terminalRef={createRef<TerminalType>()}
      terminalHostRef={createRef<HTMLDivElement>()}
      issues={[]}
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
  it('shows one Bash terminal with touch-friendly terminal controls', () => {
    const markup = renderChrome();
    expect(markup.match(/<h2>Terminal<\/h2>/g)).toHaveLength(1);
    expect(markup).toContain('Browser-local Bash');
    expect(markup).not.toContain('Node / npm');
    expect(markup).toContain('Paste');
    expect(markup).toContain('Restart');
    expect(markup).toContain('Ctrl+C');
    expect(markup).toContain('previous command');
  });

  it('does not expose a second terminal runtime selector', () => {
    const markup = renderChrome();
    expect(markup).not.toContain('Node / npm');
    expect(markup).not.toContain('Choose runtime in this terminal');
    expect(markup).toContain('pwd');
    expect(markup).toContain('help');
  });
});
