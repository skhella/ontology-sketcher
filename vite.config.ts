import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app at https://skhella.github.io/ontology-sketcher/.
  base: '/ontology-sketcher/',
  plugins: [react()],
})
