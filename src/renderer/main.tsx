import {
  Profiler,
  StrictMode,
  type ProfilerOnRenderCallback,
} from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/nunito-sans/latin-700.css';

import { App } from './App';
import './components/form/form.css';
import './components/layout/layout.css';
import './components/feedback/feedback.css';
import './components/color/color-swatch-picker.css';
import './components/menu/menu.css';
import './components/tooltip/tooltip.css';
import './components/twemoji/twemoji.css';
import './theme.css';
import './components/dialog/dialog.css';
import './styles.css';
import './components/rail/rail.css';
import './pages/settings/settings.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element was not found.');
}

const performanceDiagnostic = new URL(window.location.href).searchParams.has(
  'performance-diagnostic',
);
const onProfilerRender: ProfilerOnRenderCallback = (
  _id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  (window.__flyoffPerformanceReactCommits ??= []).push({
    actualDuration,
    baseDuration,
    commitTime,
    phase,
    scenario:
      document.documentElement.dataset.performanceDiagnosticScenario ?? null,
    startTime,
  });
};

createRoot(root).render(
  <StrictMode>
    {performanceDiagnostic ? (
      <Profiler id="Flyoff" onRender={onProfilerRender}>
        <App />
      </Profiler>
    ) : (
      <App />
    )}
  </StrictMode>,
);
