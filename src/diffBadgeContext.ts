import { createContext } from 'react'
import type { EntityDiff } from './diff'

/** While comparing, what changed on each class drawn on the page (ghosts of removed classes included), by node id. */
export const DiffBadgeContext = createContext<Map<string, EntityDiff>>(new Map())
