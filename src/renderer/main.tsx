import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';

import { App } from './App';
import './components/layout/layout.css';
import './components/feedback/feedback.css';
import './components/menu/menu.css';
import './components/tooltip/tooltip.css';
import './theme.css';
import './components/dialog/dialog.css';
import './styles.css';
import './components/rail/rail.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
