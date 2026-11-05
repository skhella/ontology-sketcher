import { describe, expect, it } from 'vitest'
import { localStore, writeAutosave } from './autosave'
import { emptyProject, projectFromJson, sampleProject } from './project'
import { chooseStart, noteOpening, openedFine, safeStartNotice, SET_ASIDE_KEY } from './safeStart'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  }
}

describe('safe start', () => {
  it('counts openings that never settled, and forgets them once one does', () => {
    const storage = memoryStorage()
    expect(noteOpening(storage)).toBe(0)
    expect(noteOpening(storage)).toBe(1)
    expect(noteOpening(storage)).toBe(2)
    openedFine(storage)
    expect(noteOpening(storage)).toBe(0)
  })

  it('opens the autosave, or the sample on a first visit', async () => {
    const storage = memoryStorage()
    const stores = [localStore(storage)!]
    const aside = [localStore(storage, SET_ASIDE_KEY)!]
    const first = await chooseStart(0, stores, aside)
    expect(first.start.iri).toBe(sampleProject().iri)
    expect(first.safe).toBeUndefined()
    const project = emptyProject()
    await writeAutosave({ ...project, name: 'Mine' }, stores)
    expect((await chooseStart(1, stores, aside)).start.name).toBe('Mine')
  })

  it('after two failed openings starts empty and sets the autosave aside for download', async () => {
    const storage = memoryStorage()
    const stores = [localStore(storage)!]
    const aside = [localStore(storage, SET_ASIDE_KEY)!]
    await writeAutosave({ ...sampleProject(), name: 'Heavy' }, stores)
    const safe = await chooseStart(2, stores, aside)
    expect(safe.safe).toBe('set aside')
    expect(safe.start.name).toBeUndefined()
    expect(safe.start.workspace.pages[0].nodes).toEqual([])
    expect(projectFromJson(safe.setAside!).name).toBe('Heavy')
    expect(storage.items.has(SET_ASIDE_KEY)).toBe(true)
    // The next normal opening still offers the set-aside project.
    expect(projectFromJson((await chooseStart(0, stores, aside)).setAside!).name).toBe('Heavy')
    expect(safeStartNotice('set aside')).toContain('Download set-aside project')
  })

  it('keeps the set-aside project in memory when storage refuses it, and says so', async () => {
    const storage = memoryStorage()
    const stores = [localStore(storage)!]
    await writeAutosave({ ...sampleProject(), name: 'Heavy' }, stores)
    const full = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error('QuotaExceededError') } }
    const safe = await chooseStart(3, stores, [localStore(full)!])
    expect(safe.safe).toBe('not kept')
    expect(projectFromJson(safe.setAside!).name).toBe('Heavy')
    expect(await chooseStart(2, [localStore(memoryStorage())!], [localStore(memoryStorage(), SET_ASIDE_KEY)!])).toMatchObject({ safe: 'nothing to set aside' })
  })
})
