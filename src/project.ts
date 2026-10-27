import { sampleOntology, type KeptProperty, type KeptStatement, type Namespace } from './model'
import { workspaceFrom, type Workspace } from './pages'
import { readQuestions, type CompetencyQuestion } from './questions'

/**
 * A project is everything needed to pick the work up again: the ontology IRI, every page with its
 * positions, colours and curves, the other namespaces classes can live in, and the shared store of classes and relations with their axioms,
 * annotations, SHACL constraints and SKOS kinds. The same shape is autosaved in the browser and
 * written to a project file. The name is the user's own; saving uses it as the file name. The competency questions
 * travel with the project only, never in the export.
 */
export type Project = {
  name?: string
  iri: string
  namespaces?: Namespace[]
  kept?: KeptProperty[]
  keptStatements?: KeptStatement[]
  questions?: CompetencyQuestion[]
  workspace: Workspace
  pageId: string
}

/** Marks a project file, so opening some other JSON file fails with a clear message. */
const FORMAT = 'ontology-sketcher-project'
const VERSION = 1

export const AUTOSAVE_KEY = 'ontology-sketch:project'

export const PROJECT_EXTENSION = '.sketcher.json'

/** The pizza sample, shown on a first visit. */
export function sampleProject(): Project {
  const { workspace, pageId } = workspaceFrom('Page 1', sampleOntology.nodes, sampleOntology.edges)
  return { iri: sampleOntology.iri, workspace, pageId }
}

/** One empty page, for starting over. */
export function emptyProject(): Project {
  const { workspace, pageId } = workspaceFrom('Page 1', [], [])
  return { iri: 'http://example.org/ontology#', workspace, pageId }
}

export function projectToJson(project: Project): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, ...project }, null, 2)
}

/** Reads a project file or autosave; throws with a message fit to show when the text is not one. */
export function projectFromJson(text: string): Project {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('it is not a project file (not JSON)')
  }
  const p = data as Partial<Project & { format: string; version: number }>
  if (!p || typeof p !== 'object' || p.format !== FORMAT) throw new Error('it is not an Ontology Sketcher project file')
  if (typeof p.version !== 'number' || p.version > VERSION) throw new Error('it was saved by a newer version of Ontology Sketcher')
  const ws = p.workspace
  if (
    typeof p.iri !== 'string' ||
    !ws ||
    !Array.isArray(ws.pages) ||
    ws.pages.length === 0 ||
    !ws.store ||
    typeof ws.store.classes !== 'object' ||
    typeof ws.store.relations !== 'object'
  )
    throw new Error('the project file is incomplete')
  const pageId = ws.pages.some((page) => page.id === p.pageId) ? (p.pageId as string) : ws.pages[0].id
  const namespaces = Array.isArray(p.namespaces)
    ? p.namespaces.filter((n) => n && typeof n.prefix === 'string' && typeof n.iri === 'string')
    : []
  const kept = Array.isArray(p.kept) ? p.kept.filter((k) => k && typeof k.iri === 'string' && (k.kind === 'object' || k.kind === 'data')) : []
  const keptStatements = Array.isArray(p.keptStatements) ? p.keptStatements.filter((s) => s && typeof s.ntriples === 'string') : []
  const questions = readQuestions(p.questions)
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  return {
    ...(name && { name }),
    iri: p.iri,
    ...(namespaces.length > 0 && { namespaces }),
    ...(kept.length > 0 && { kept }),
    ...(keptStatements.length > 0 && { keptStatements }),
    ...(questions.length > 0 && { questions }),
    workspace: ws,
    pageId,
  }
}

/** The project autosaved in this browser, or null when there is none or it cannot be read. */
export function loadAutosave(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Project | null {
  try {
    const text = storage?.getItem(AUTOSAVE_KEY)
    return text ? projectFromJson(text) : null
  } catch {
    return null
  }
}

/** Saves the project in this browser; returns false when storage is full or refused (e.g. a private window). */
export function writeAutosave(project: Project, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(AUTOSAVE_KEY, projectToJson(project))
    return !!storage
  } catch {
    return false
  }
}

/** The name a project goes by until the user gives it one: the ontology IRI's last part, e.g. pizza for http://example.org/pizza#. */
export function defaultProjectName(iri: string): string {
  return iri.replace(/[#/]+$/, '').split(/[#/:]/).pop() || 'ontology'
}

/** The project's name as it was saved, from a file name such as Pizza v2.sketcher.json. */
export function nameFromFileName(fileName: string): string {
  return fileName.replace(/\.sketcher\.json$|\.json$/i, '').trim()
}

/** A file name from the project's name, or else from the ontology IRI's last part, e.g. http://example.org/pizza# gives pizza.sketcher.json. */
export function projectFileName(iri: string, name?: string): string {
  const base = (name?.trim() || defaultProjectName(iri)).replace(/[^\w. -]+/g, '-').replace(/^[ .]+|[ .]+$/g, '')
  return `${base || 'ontology'}${PROJECT_EXTENSION}`
}
