import { useState } from 'react'

const STORAGE_KEY = 'ontology-sketch:canvas-help'

/** The help line shows until the user hides it; only an explicit "hidden" keeps it away. */
export function helpShown(stored: string | null): boolean {
  return stored !== 'hidden'
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Whether the toolbar's help line is shown, remembered across visits like the theme. */
export function useCanvasHelp(): [boolean, () => void] {
  const [shown, setShown] = useState(() => helpShown(readStored()))

  const toggle = () => {
    const next = !shown
    setShown(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'shown' : 'hidden')
    } catch {
      // Private windows can refuse storage; the choice still holds for this visit.
    }
  }

  return [shown, toggle]
}
