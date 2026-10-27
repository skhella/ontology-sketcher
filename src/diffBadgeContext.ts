import { createContext } from 'react'
import type { EntityDiff } from './diff'

/**
 * While comparing, what changed on each class drawn on the page (ghosts of classes only the file has included), by
 * node id; and the one class whose changes are open beside it.
 */
export type DiffBadges = { changes: Map<string, EntityDiff>; open: string | null; setOpen: (nodeId: string | null) => void }

export const DiffBadgeContext = createContext<DiffBadges>({ changes: new Map(), open: null, setOpen: () => {} })
