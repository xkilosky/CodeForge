import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallResult = 'accepted' | 'dismissed' | 'manual';

function standaloneMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function usePwaInstall() {
  const [installed, setInstalled] = useState(() => standaloneMode());
  const [appleMobile, setAppleMobile] = useState(() => isAppleMobile());
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const updateDisplayMode = () => setInstalled(standaloneMode());
    const markInstalled = () => setInstalled(true);
    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener?.('change', updateDisplayMode);
    window.addEventListener('appinstalled', markInstalled);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    // iPadOS reports itself as a Mac; touch points are the useful distinction.
    setAppleMobile(isAppleMobile());
    return () => {
      media?.removeEventListener?.('change', updateDisplayMode);
      window.removeEventListener('appinstalled', markInstalled);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  const requestInstall = useCallback(async (): Promise<InstallResult> => {
    if (!promptEvent) return 'manual';
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setPromptEvent(null);
      if (choice.outcome === 'accepted') setInstalled(true);
      return choice.outcome;
    } catch {
      setPromptEvent(null);
      return 'manual';
    }
  }, [promptEvent]);

  return {
    installed,
    appleMobile,
    canPrompt: promptEvent !== null,
    requestInstall,
  };
}
