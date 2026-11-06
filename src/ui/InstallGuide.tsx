import { useEffect } from 'react';
import { CloseIcon } from './icons';

interface InstallGuideProps {
  open: boolean;
  appleMobile: boolean;
  onClose: () => void;
}

export function InstallGuide({ open, appleMobile, onClose }: InstallGuideProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="install-guide-scrim"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="install-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
      >
        <header className="install-guide-head">
          <div className="install-guide-brand">
            <img src="/icon-192.png" width="42" height="42" alt="" />
            <div>
              <p className="install-guide-eyebrow">CODEFORGE APP</p>
              <h2 id="install-guide-title">Install on this device</h2>
            </div>
          </div>
          <button className="btn ghost" type="button" onClick={onClose} aria-label="Close install instructions">
            <CloseIcon size={16} />
          </button>
        </header>

        {appleMobile ? (
          <div className="install-guide-content">
            <p>Install CodeForge from <strong>Safari</strong> so it opens from your Home Screen like an app.</p>
            <ol>
              <li>Open this page in Safari and tap the <strong>Share</strong> button.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong>. CodeForge will appear with your other apps.</li>
            </ol>
            <p className="install-guide-note">Your projects stay in this browser on this device. They are not automatically copied to another phone.</p>
          </div>
        ) : (
          <div className="install-guide-content">
            <p>Add CodeForge to your Home Screen or app launcher for a full-screen, app-like window.</p>
            <ol>
              <li>Open your browser menu or the install icon in the address bar.</li>
              <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
              <li>Confirm <strong>Install</strong> or <strong>Add</strong>.</li>
            </ol>
            <p className="install-guide-note">If the install option is missing, use a supported browser over HTTPS and try again after the page has loaded.</p>
          </div>
        )}

        <footer className="install-guide-actions">
          <button className="btn primary" type="button" onClick={onClose}>Got it</button>
        </footer>
      </section>
    </div>
  );
}
