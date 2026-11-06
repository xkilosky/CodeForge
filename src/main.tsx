import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { currentRelease } from './core/release';
import './styles.css';

// The tab title carries the release, so a user with three CodeForge windows open
// can tell which build each one is running.
document.title = currentRelease().title;

const host = document.getElementById('root');
if (!host) throw new Error('missing #root');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep development HMR controlled by Vite; install the app-shell worker only
// on an HTTPS production deployment (localhost is also a secure context).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('CodeForge offline support could not be enabled.', error);
    });
  }, { once: true });
}
