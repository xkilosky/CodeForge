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
