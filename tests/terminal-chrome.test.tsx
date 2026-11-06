import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Terminal as TerminalType } from '@xterm/xterm';
import type { TerminalActivity } from '../src/core/terminalActivity';
import { TerminalChrome } from '../src/ui/TerminalChrome';

const noop = () => {};

function renderChrome(status: 'ready' | 'error' = 'ready', activity: TerminalActivity | null = null): string {
  return renderToStaticMarkup(
    <TerminalChrome
      status={status}
      statusMessage={status === 'error' ? 'Wasmer package could not load' : 'Shell ready'}
      activity={activity}
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
    expect(markup).toContain('cf-help · bat · delta · fzf');
  });

  it('does not expose a second terminal runtime selector', () => {
    const markup = renderChrome();
    expect(markup).not.toContain('Node / npm');
    expect(markup).not.toContain('Choose runtime in this terminal');
    expect(markup).toContain('pwd');
    expect(markup).toContain('help');
  });

  it('renders a live progress bar and elapsed time for active work', () => {
    const markup = renderChrome('ready', { label: 'Running tests', percent: 42, startedAt: Date.now() - 5000 });
    expect(markup).toContain('Running tests');
    expect(markup).toContain('42%');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('5s');
  });

  it('shows the actual Bash startup failure instead of only a generic status', () => {
    const markup = renderChrome('error');
    expect(markup).toContain('Bash needs attention');
    expect(markup).toContain('Wasmer package could not load');
    expect(markup).toContain('Use Retry above');
  });
});
