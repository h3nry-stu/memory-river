import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { installCaptureProbe } from '@/dev/captureProbe';
import '@/styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

installCaptureProbe();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
