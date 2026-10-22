import type { Project } from './project'

/**
 * Undo and redo keep whole projects, like the autosave does: every page, the shared store, the IRI
 * and the namespaces. A step is one settled change, so a drag of one class or of a whole selection
 * is one step, and so is a burst of typing in the inspector (the app records once things go quiet).
 */
export type History = { past: Project[]; present: Project; presentKey: string; future: Project[] }

/** How many steps back undo can go. */
export const HISTORY_LIMIT = 100

// What React Flow sets while drawing (selection, drag state, measured size) is not an edit.
const NOT_EDITS = new Set(['selected', 'dragging', 'measured', 'resizing'])

/** Two projects with the same key differ only in which page is open or what is selected. */
export function historyKey(project: Project): string {
  const { iri, namespaces = [], kept = [], keptStatements = [], workspace } = project
  // The canvas draws an edge that names no dots from top to bottom (withDefaultHandles in App.tsx),
  // so filling those in when a page is opened is not an edit either.
  const pages = workspace.pages.map((p) => ({
    ...p,
    edges: p.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? 'top', targetHandle: e.targetHandle ?? 'bottom' })),
  }))
  const content = { iri, namespaces, kept, keptStatements, workspace: { ...workspace, pages } }
  return JSON.stringify(content, (key, value) => (NOT_EDITS.has(key) ? undefined : value))
}

export function startHistory(project: Project): History {
  return { past: [], present: project, presentKey: historyKey(project), future: [] }
}

/**
 * Notes the project as it is now. A real change becomes a new step and clears redo; otherwise the
 * present is only refreshed, so undo later returns to the page that was open when a change was made.
 */
export function record(history: History, project: Project): History {
  const key = historyKey(project)
  if (key === history.presentKey) return { ...history, present: project }
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: project, presentKey: key, future: [] }
}

export function undo(history: History): History | null {
  const previous = history.past.at(-1)
  if (!previous) return null
  return { past: history.past.slice(0, -1), present: previous, presentKey: historyKey(previous), future: [history.present, ...history.future] }
}

export function redo(history: History): History | null {
  const [next, ...future] = history.future
  if (!next) return null
  return { past: [...history.past, history.present], present: next, presentKey: historyKey(next), future }
}
