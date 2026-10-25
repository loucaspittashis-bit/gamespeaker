import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './styles/app.css';
import { App } from './App';
import { CrashGuard } from './components/CrashGuard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
      <App />
    </CrashGuard>
  </StrictMode>,
);
