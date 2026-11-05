import '@fontsource/shantell-sans/400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { chooseStart, noteOpening, openedFine, SETTLED_MS } from './safeStart'

// Each opening counts until the page has run a while or is closed normally, so a crash loop is noticed, see safeStart.ts.
const failedOpenings = noteOpening()
setTimeout(() => openedFine(), SETTLED_MS)
window.addEventListener('pagehide', () => openedFine())

// The project autosaved in this browser comes back on reload (reading it is asynchronous, see autosave.ts);
// a first visit opens the pizza sample, and a crash loop an empty page.
void chooseStart(failedOpenings).then(({ start, safe, setAside }) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App start={start} safeStart={safe} setAside={setAside} />
    </StrictMode>,
  ),
)
