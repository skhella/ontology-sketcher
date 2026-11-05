import { describe, expect, it } from 'vitest'
import { localStore, loadAutosave, writeAutosave, type AutosaveStore } from './autosave'
import { AUTOSAVE_KEY, emptyProject, projectToJson, sampleProject } from './project'

/** An in-memory stand-in for localStorage. */
function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  }
}

/** A place that holds one text, or refuses every call when `broken`. */
function memoryStore(text: string | null = null) {
  const store = {
    text,
    broken: false,
    get: async () => {
      if (store.broken) throw new Error('refused')
      return store.text
    },
    set: async (t: string) => {
      if (store.broken) throw new Error('QuotaExceededError')
      store.text = t
    },
    remove: async () => {
      if (store.broken) throw new Error('refused')
      store.text = null
    },
  }
  return store satisfies AutosaveStore
}

describe('autosave', () => {
  it('saves to and restores from localStorage', async () => {
    const storage = memoryStorage()
    const stores = [localStore(storage)!]
    expect(await loadAutosave(stores)).toBeNull()
    const project = sampleProject()
    expect(await writeAutosave(project, stores)).toBe(true)
    expect(storage.items.get(AUTOSAVE_KEY)).not.toContain('\n')
    expect(await loadAutosave(stores)).toEqual(project)
  })

  it('saves to the first place and frees the older copy in the fallback', async () => {
    const db = memoryStore()
    const storage = memoryStorage()
    storage.setItem(AUTOSAVE_KEY, projectToJson(emptyProject()))
    const project = sampleProject()
    expect(await writeAutosave(project, [db, localStore(storage)!])).toBe(true)
    expect(db.text).not.toBeNull()
    expect(storage.items.has(AUTOSAVE_KEY)).toBe(false)
    expect(await loadAutosave([db, localStore(storage)!])).toEqual(project)
  })

  it('brings back an autosave written before the first place was used', async () => {
    const storage = memoryStorage()
    const project = sampleProject()
    storage.setItem(AUTOSAVE_KEY, projectToJson(project))
    expect(await loadAutosave([memoryStore(), localStore(storage)!])).toEqual(project)
  })

  it('falls back when the first place refuses, and restores the newer save', async () => {
    const db = memoryStore()
    const storage = memoryStorage()
    const older = emptyProject()
    expect(await writeAutosave(older, [db, localStore(storage)!], 1)).toBe(true)
    db.broken = true
    const newer = sampleProject()
    expect(await writeAutosave(newer, [db, localStore(storage)!], 2)).toBe(true)
    db.broken = false
    expect(db.text).not.toBeNull()
    expect(await loadAutosave([db, localStore(storage)!])).toEqual(newer)
  })

  it('reports when no place takes the save, and ignores an unreadable autosave', async () => {
    const broken = memoryStore()
    broken.broken = true
    const full = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(await writeAutosave(sampleProject(), [broken, localStore(full)!])).toBe(false)
    expect(await writeAutosave(sampleProject(), [])).toBe(false)
    expect(await loadAutosave([memoryStore('{broken'), broken])).toBeNull()
  })
})
