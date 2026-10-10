import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ontology-sketch:theme'

/** A theme the user picked earlier wins; otherwise follow the system setting. */
export function initialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * The app's colour theme, set as data-theme on <html> so index.css can switch its variables.
 * Like Excalidraw, dark mode only changes how the canvas is drawn (see index.css):
 * stored colours and the OWL export stay the same.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    initialTheme(readStored(), window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private windows can refuse storage; the theme still applies for this visit.
    }
  }

  return [theme, toggle]
}
