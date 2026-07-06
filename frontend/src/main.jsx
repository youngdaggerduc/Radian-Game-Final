import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (bundled into dist/ — no CDN, works offline at the booth).
// Black Ops One = stencil display for titles/banners/canvas signage.
// Saira = body text; Saira Condensed = HUD numerals and compact labels.
import '@fontsource/black-ops-one'
import '@fontsource/saira/400.css'
import '@fontsource/saira/600.css'
import '@fontsource/saira/700.css'
import '@fontsource/saira-condensed/600.css'
import '@fontsource/saira-condensed/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
