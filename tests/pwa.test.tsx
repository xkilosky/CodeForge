// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { usePwaInstall } from '../src/ui/usePwaInstall';
import { InstallGuide } from '../src/ui/InstallGuide';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function InstallProbe({ onResult }: { onResult: (result: string) => void }) {
  const install = usePwaInstall();
  return (
    <div>
      <span data-testid="install-state">{install.installed ? 'installed' : 'not-installed'}</span>
      <span data-testid="install-prompt">{install.canPrompt ? 'available' : 'manual'}</span>
      <button onClick={() => void install.requestInstall().then(onResult)}>Install</button>
    </div>
  );
}

function mount(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe('installable mobile app', () => {
  it('has a standalone manifest with the required app and maskable icons', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
      start_url: string;
      scope: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ src: '/icon-maskable-512.png', purpose: 'maskable' }),
    ]));

    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-touch-icon.png');
  });

  it('registers a same-origin app-shell worker for offline reopening', () => {
    const entry = readFileSync('src/main.tsx', 'utf8');
    const worker = readFileSync('public/sw.js', 'utf8');
    expect(entry).toContain("serviceWorker.register('/sw.js'");
    expect(worker).toContain("addEventListener('fetch'");
    expect(worker).toContain('url.origin !== self.location.origin');
    expect(worker).toContain("caches.match('/')");
    expect(JSON.parse(readFileSync('vercel.json', 'utf8'))).toBeTruthy();
  });

  it('uses the browser install prompt when available', async () => {
    const onResult = vi.fn();
    const host = mount(<InstallProbe onResult={onResult} />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });

    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector('[data-testid="install-prompt"]')?.textContent).toBe('available');

    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith('accepted');
    expect(host.querySelector('[data-testid="install-state"]')?.textContent).toBe('installed');
  });

  it('falls back to browser installation instructions when no native prompt is exposed', async () => {
    const onResult = vi.fn();
    const host = mount(<InstallProbe onResult={onResult} />);
    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(onResult).toHaveBeenCalledWith('manual');
  });

  it('provides iPhone Add to Home Screen steps', () => {
    const host = mount(<InstallGuide open appleMobile onClose={vi.fn()} />);
    expect(host.textContent).toContain('Safari');
    expect(host.textContent).toContain('Add to Home Screen');
    expect(host.textContent).toContain('Share');
  });
});
