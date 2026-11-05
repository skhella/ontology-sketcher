import { useState } from 'react'

const STORAGE_KEY = 'ontology-sketch:toolbar'

/** Below this width (phones) the toolbar starts folded away until the user opens it. */
export const NARROW_SCREEN = '(max-width: 700px)'

/** A stored choice wins; without one the toolbar starts collapsed on narrow screens only. */
export function toolbarCollapsed(stored: string | null, narrow: boolean): boolean {
  if (stored === 'collapsed') return true
  if (stored === 'expanded') return false
  return narrow
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function isNarrow(): boolean {
  try {
    return window.matchMedia(NARROW_SCREEN).matches
  } catch {
    return false
  }
}

/** Whether the top toolbar is folded down to one row, remembered across visits like the help line. */
export function useToolbarCollapse(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => toolbarCollapsed(readStored(), isNarrow()))

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      // Private windows can refuse storage; the choice still holds for this visit.
    }
  }

  return [collapsed, toggle]
}
