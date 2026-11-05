import '@fontsource/shantell-sans/400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadAutosave } from './autosave'
import { sampleProject } from './project'

// The project autosaved in this browser comes back on reload (reading it is asynchronous, see autosave.ts);
// a first visit opens the pizza sample.
void loadAutosave().then((saved) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App start={saved ?? sampleProject()} />
    </StrictMode>,
  ),
)
