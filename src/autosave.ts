import { AUTOSAVE_KEY, projectFromJson, projectToJson, type Project } from './project'

/**
 * The autosave keeps the whole project in this browser. It goes to IndexedDB, which has room for large ontologies,
 * and falls back to localStorage where IndexedDB is missing or refuses the save.
 *
 * localStorage alone was not enough: WebKit (Safari and every browser on iPhone and iPad) allows about 5 MB per site
 * and counts each character as two bytes, so a project of a few thousand classes did not fit. The autosave is also
 * written without indentation, which roughly halves it, so the fallback still holds fairly large projects.
 *
 * Each save carries the time it was written. Loading reads both places and takes the newer one, so an autosave
 * from before IndexedDB was used comes back, and a save that only reached the fallback is never hidden by an older
 * one in IndexedDB. Once a save reaches IndexedDB, the copy in localStorage is removed to free that space.
 */

/** One place the autosave text can live. Every method rejects when the place is missing or refuses. */
export type AutosaveStore = {
  get(): Promise<string | null>
  set(text: string): Promise<void>
  remove(): Promise<void>
}

const DB_NAME = 'ontology-sketcher'
const DB_STORE = 'autosave'

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('the save was aborted'))
  })
}

/** The autosave (or another copy, under `key`) in IndexedDB, or undefined where the browser has none. */
export function indexedDbStore(factory: IDBFactory | undefined = globalThis.indexedDB, key = AUTOSAVE_KEY): AutosaveStore | undefined {
  if (!factory) return undefined
  let db: Promise<IDBDatabase> | undefined
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE)
      request.onsuccess = () => {
        const opened = request.result
        // iOS may drop the connection while the tab is in the background; the next save opens a new one.
        opened.onclose = () => (db = undefined)
        resolve(opened)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('the browser database is blocked'))
    }).catch((error: unknown) => {
      db = undefined
      throw error
    })
    return db
  }
  // A connection that died without telling us fails on its first transaction; one fresh try follows.
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      let tx: IDBTransaction
      try {
        tx = (await open()).transaction(DB_STORE, mode)
      } catch (error) {
        db = undefined
        if (attempt > 0) throw error
        continue
      }
      return work(tx.objectStore(DB_STORE), tx)
    }
  }
  return {
    get: () =>
      run('readonly', async (store) => {
        const text: unknown = await done(store.get(key))
        return typeof text === 'string' ? text : null
      }),
    set: (text) =>
      run('readwrite', (store, tx) => {
        store.put(text, key)
        return finished(tx)
      }),
    remove: () =>
      run('readwrite', (store, tx) => {
        store.delete(key)
        return finished(tx)
      }),
  }
}

/** The autosave (or another copy, under `key`) in localStorage, or undefined where it is missing or blocked (reading it can throw). */
export function localStore(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key = AUTOSAVE_KEY): AutosaveStore | undefined {
  try {
    storage ??= globalThis.localStorage
  } catch {
    return undefined
  }
  if (!storage) return undefined
  const s = storage
  return {
    get: async () => s.getItem(key),
    set: async (text) => s.setItem(key, text),
    remove: async () => s.removeItem(key),
  }
}

/** IndexedDB first, then localStorage. */
export function browserStores(key = AUTOSAVE_KEY): AutosaveStore[] {
  return [indexedDbStore(undefined, key), localStore(undefined, key)].filter((s): s is AutosaveStore => !!s)
}

/** When an autosave was written; 0 for one written before autosaves carried the time. */
function savedAtOf(text: string): number {
  try {
    const savedAt = (JSON.parse(text) as { savedAt?: unknown }).savedAt
    return typeof savedAt === 'number' ? savedAt : 0
  } catch {
    return 0
  }
}

/** The newest readable autosave in `stores` and its text, or null when there is none. */
export async function newestAutosave(stores: AutosaveStore[] = browserStores()): Promise<{ project: Project; text: string } | null> {
  let best: { project: Project; text: string; savedAt: number } | null = null
  for (const store of stores) {
    try {
      const text = await store.get()
      if (!text) continue
      const project = projectFromJson(text)
      const savedAt = savedAtOf(text)
      if (!best || savedAt > best.savedAt) best = { project, text, savedAt }
    } catch {
      // Unreadable or refused: try the next place.
    }
  }
  return best && { project: best.project, text: best.text }
}

/** The newest readable autosave in `stores`, or null when there is none. */
export async function loadAutosave(stores: AutosaveStore[] = browserStores()): Promise<Project | null> {
  return (await newestAutosave(stores))?.project ?? null
}

/** Keeps `text` in the first of `stores` that takes it; false when none does. */
export async function keepText(text: string, stores: AutosaveStore[]): Promise<boolean> {
  for (const store of stores) {
    try {
      await store.set(text)
      return true
    } catch {
      // Refused: try the next place.
    }
  }
  return false
}

/**
 * Saves the project in the first of `stores` that takes it and removes older copies from the ones after it.
 * Returns false when none takes it (storage full or refused, e.g. some private windows).
 */
export async function writeAutosave(project: Project, stores: AutosaveStore[] = browserStores(), now = Date.now()): Promise<boolean> {
  const text = projectToJson(project, { compact: true, savedAt: now })
  for (const [i, store] of stores.entries()) {
    try {
      await store.set(text)
    } catch {
      continue
    }
    for (const later of stores.slice(i + 1)) await later.remove().catch(() => undefined)
    return true
  }
  return false
}
