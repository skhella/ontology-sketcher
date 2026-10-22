import { createContext } from 'react'

/** The detail pages classes on the canvas can open, by class id, and how to open one. */
export type PageLinks = { detail: Map<string, { id: string; name: string }>; open: (pageId: string) => void }

export const PageLinksContext = createContext<PageLinks>({ detail: new Map(), open: () => {} })
