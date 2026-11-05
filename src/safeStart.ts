import { browserStores, keepText, newestAutosave, type AutosaveStore } from './autosave'
import { emptyProject, sampleProject, type Project } from './project'

/**
 * A guard against a crash loop. If the browser closes the page while it is opening (on iPad and iPhone, Safari does
 * this when a tab runs out of memory, and reloads it), the autosaved project that caused it would come back on every
 * reload. So each opening is counted until the page has run for a while or is closed normally; when two openings in
 * a row never got that far, the next one starts with an empty page and sets the autosaved project aside, where it
 * can still be downloaded as a project file.
 */

const OPENINGS_KEY = 'ontology-sketch:openings'
export const SET_ASIDE_KEY = 'ontology-sketch:set-aside'

/** How long the page has to run before an opening counts as fine. */
export const SETTLED_MS = 10_000

type Counter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function counter(storage?: Counter): Counter | undefined {
  try {
    return storage ?? globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Counts this opening; returns how many openings before it never settled. */
export function noteOpening(storage?: Counter): number {
  const s = counter(storage)
  try {
    const before = Number(s?.getItem(OPENINGS_KEY)) || 0
    s?.setItem(OPENINGS_KEY, String(before + 1))
    return before
  } catch {
    return 0
  }
}

/** This opening went fine: the page ran long enough or was closed normally. */
export function openedFine(storage?: Counter) {
  try {
    counter(storage)?.removeItem(OPENINGS_KEY)
  } catch {
    // Nothing to do where storage is blocked.
  }
}

export type Start = {
  start: Project
  /** Set when this opening is a safe start: whether the autosaved project was set aside, or why not. */
  safe?: 'set aside' | 'nothing to set aside' | 'not kept'
  /** The project set aside after a crash loop, as project-file text; it stays until the next one replaces it. */
  setAside?: string
}

/**
 * The project to open with: the autosave, or the pizza sample on a first visit; after `failedOpenings` of 2 or more,
 * an empty page, with the autosave set aside first.
 */
export async function chooseStart(
  failedOpenings: number,
  stores: AutosaveStore[] = browserStores(),
  asideStores: AutosaveStore[] = browserStores(SET_ASIDE_KEY),
): Promise<Start> {
  let setAside: string | undefined
  for (const store of asideStores) {
    setAside = (await store.get().catch(() => null)) ?? undefined
    if (setAside) break
  }
  if (failedOpenings < 2) return { start: (await newestAutosave(stores))?.project ?? sampleProject(), ...(setAside && { setAside }) }
  const saved = await newestAutosave(stores)
  if (!saved) return { start: emptyProject(), safe: 'nothing to set aside', ...(setAside && { setAside }) }
  // Kept in memory as well, so it can be downloaded this time even where storage refuses it.
  const kept = await keepText(saved.text, asideStores)
  return { start: emptyProject(), safe: kept ? 'set aside' : 'not kept', setAside: saved.text }
}

/** What a safe start says to the person. */
export function safeStartNotice(safe: NonNullable<Start['safe']>): string {
  const first = 'The page closed unexpectedly twice while opening (perhaps it ran out of memory), so it started with an empty page.'
  if (safe === 'nothing to set aside') return first
  if (safe === 'not kept') return `${first} Your last autosaved project could not be kept in this browser: use Project, Download set-aside project now to keep it as a file.`
  return `${first} Your last autosaved project is set aside: Project, Download set-aside project saves it as a file.`
}
