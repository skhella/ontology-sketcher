import { describe, expect, it } from 'vitest'
import { loadCanvas, saveCanvas } from './pages'
import { AUTOSAVE_KEY, emptyProject, loadAutosave, nameFromFileName, projectFileName, projectFromJson, projectToJson, sampleProject, writeAutosave } from './project'

/** An in-memory stand-in for localStorage. */
function memoryStorage() {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items }
}

describe('project', () => {
  it('round-trips every page, position, style and SHACL constraint through a project file', () => {
    const sample = sampleProject()
    const canvas = loadCanvas(sample.workspace, sample.pageId)
    const [first, ...rest] = canvas.nodes
    const edited = {
      ...first,
      position: { x: 512, y: -40 },
      data: { ...first.data, style: { fill: '#ffec99' }, constraints: [{ path: { type: 'data' as const, name: 'name' }, minCount: 1 }] },
    }
    const workspace = saveCanvas(sample.workspace, sample.pageId, [edited, ...rest], canvas.edges)
    const second = { id: 'p2', name: 'Second', nodes: [], edges: [] }
    const kept = [{ kind: 'object' as const, iri: 'http://example.org/zoo#status', label: 'status', labelLang: 'en', ranges: ['http://www.w3.org/2004/02/skos/core#Concept'] }]
    const project = {
      iri: 'http://example.org/zoo#',
      namespaces: [{ prefix: 'rdl', iri: 'http://example.org/rdl/' }],
      kept,
      keptStatements: [{ ntriples: '<http://example.org/zoo#tom> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/zoo#Cat> .\n' }],
      workspace: { ...workspace, pages: [...workspace.pages, second] },
      pageId: 'p2',
    }

    const opened = projectFromJson(projectToJson(project))

    expect(opened).toEqual(project)
    const reopened = loadCanvas(opened.workspace, sample.pageId).nodes.find((n) => n.id === first.id)
    expect(reopened?.position).toEqual({ x: 512, y: -40 })
    expect(reopened?.data.style).toEqual({ fill: '#ffec99' })
    expect(reopened?.data.constraints).toHaveLength(1)
  })

  it('refuses files that are not projects, with a reason to show', () => {
    expect(() => projectFromJson('@prefix owl: <http://www.w3.org/2002/07/owl#> .')).toThrow('not JSON')
    expect(() => projectFromJson('{"type":"excalidraw","elements":[]}')).toThrow('not an Ontology Sketcher project')
    expect(() => projectFromJson('{"format":"ontology-sketcher-project","version":99}')).toThrow('newer version')
    expect(() => projectFromJson('{"format":"ontology-sketcher-project","version":1,"iri":"x"}')).toThrow('incomplete')
  })

  it('opens on the first page when the saved active page is missing', () => {
    const project = emptyProject()
    const opened = projectFromJson(projectToJson({ ...project, pageId: 'gone' }))
    expect(opened.pageId).toBe(project.workspace.pages[0].id)
  })

  it('autosaves to and restores from browser storage', () => {
    const storage = memoryStorage()
    expect(loadAutosave(storage)).toBeNull()
    const project = sampleProject()
    expect(writeAutosave(project, storage)).toBe(true)
    expect(storage.items.has(AUTOSAVE_KEY)).toBe(true)
    expect(loadAutosave(storage)).toEqual(project)
  })

  it('reports storage that refuses the save, and ignores an unreadable autosave', () => {
    const full = { setItem: () => { throw new Error('QuotaExceededError') } }
    expect(writeAutosave(sampleProject(), full)).toBe(false)
    expect(loadAutosave({ getItem: () => '{broken' })).toBeNull()
  })

  it('names the file after the ontology IRI', () => {
    expect(projectFileName('http://example.org/pizza#')).toBe('pizza.sketcher.json')
    expect(projectFileName('https://w3id.org/my-onto/')).toBe('my-onto.sketcher.json')
    expect(projectFileName('')).toBe('ontology.sketcher.json')
  })

  it('keeps the project name and names the file after it', () => {
    const project = { ...emptyProject(), name: 'Plant model v2' }
    expect(projectFromJson(projectToJson(project)).name).toBe('Plant model v2')
    expect(projectFromJson(projectToJson({ ...project, name: '  ' })).name).toBeUndefined()
    expect(projectFileName('http://example.org/pizza#', 'Plant model v2')).toBe('Plant model v2.sketcher.json')
    expect(projectFileName('http://example.org/pizza#', 'a/b: c?')).toBe('a-b- c-.sketcher.json')
    expect(projectFileName('http://example.org/pizza#', ' ')).toBe('pizza.sketcher.json')
  })

  it('reads the name of an older project file from its file name', () => {
    expect(nameFromFileName('Plant model.sketcher.json')).toBe('Plant model')
    expect(nameFromFileName('pizza.json')).toBe('pizza')
  })
})
