import { keptStatementsOf } from './keptStatements'
import type { EntityData, KeptStatement, Namespace } from './model'
import { mergeNamespaces } from './namespaces'
import { importOwl, type OwlImportResult } from './owlImport'
import { parseTurtle } from './turtle'
import { OWL, RDF } from './vocab'

/**
 * Standard ontologies that can be imported by name, each onto a page of its own, published as Turtle.
 * The list follows the catalogue of open-ontologies (https://github.com/fabio-rovai/open-ontologies, MIT),
 * keeping the ones that are published as Turtle and fit modelling next to your own classes.
 */
export type LibraryEntry = { id: string; name: string; description: string; url: string }

export const LIBRARY: LibraryEntry[] = [
  {
    id: 'bfo',
    name: 'BFO 2020',
    description: 'Basic Formal Ontology (ISO/IEC 21838-2), the top-level ontology behind OBO, IOF and many engineering ontologies.',
    url: 'https://raw.githubusercontent.com/BFO-ontology/BFO-2020/master/21838-2/owl/bfo-core.ttl',
  },
  {
    id: 'prov',
    name: 'PROV-O',
    description: 'Provenance: entities, activities and agents, and who did what when.',
    url: 'https://www.w3.org/ns/prov-o.ttl',
  },
  {
    id: 'time',
    name: 'OWL-Time',
    description: 'Instants, intervals, durations and calendar dates.',
    url: 'https://www.w3.org/2006/time.ttl',
  },
  {
    id: 'sosa',
    name: 'SOSA',
    description: 'Sensors, observations, samples and actuators; the lightweight core of SSN.',
    url: 'https://www.w3.org/ns/sosa.ttl',
  },
  {
    id: 'ssn',
    name: 'SSN',
    description: 'Semantic Sensor Network: systems, deployments and capabilities on top of SOSA.',
    url: 'https://www.w3.org/ns/ssn.ttl',
  },
  {
    id: 'saref',
    name: 'SAREF',
    description: 'Smart Applications REFerence ontology (ETSI): devices, functions, commands, measurements.',
    url: 'https://saref.etsi.org/core/v3.2.1/saref.ttl',
  },
  {
    id: 'org',
    name: 'W3C Organization',
    description: 'Organizations, units, memberships, posts and sites.',
    url: 'https://www.w3.org/ns/org.ttl',
  },
  {
    id: 'dcat',
    name: 'DCAT',
    description: 'Data catalogues, datasets and distributions.',
    url: 'https://www.w3.org/ns/dcat.ttl',
  },
  {
    id: 'dcterms',
    name: 'Dublin Core Terms',
    description: 'Metadata terms such as creator, created, license and subject.',
    url: 'https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl',
  },
]

/**
 * An imported ontology made to sit inside the project instead of becoming it: the project keeps its own IRI, and the
 * imported classes and properties that lived in the file's main namespace get that namespace, listed under `prefix`
 * (or another free prefix), so their IRIs stay what the file said.
 */
export function intoProject<R extends OwlImportResult>(result: R, project: { iri: string; namespaces: Namespace[] }, prefix: string): R {
  if (result.iri === project.iri) return result
  let anyMoved = false
  const moved = <T extends EntityData>(data: T): T => {
    if (data.namespace) return data
    anyMoved = true
    return { ...data, namespace: result.iri }
  }
  const nodes = result.nodes.map((n) => ({ ...n, data: { ...moved(n.data), ...(n.data.dataProperties && { dataProperties: n.data.dataProperties.map(moved) }) } }))
  const edges = result.edges.map((e) => (e.data && e.data.kind !== 'subClassOf' ? { ...e, data: moved(e.data) } : e))
  // The file's main namespace is listed only when something lives in it, e.g. not for BFO, whose classes are all under obo:.
  const own = anyMoved ? [{ prefix, iri: result.iri }] : []
  const namespaces = mergeNamespaces([...project.namespaces, ...result.namespaces], own).filter((n) => !project.namespaces.includes(n))
  return { ...result, iri: project.iri, namespaces, nodes, edges }
}

/**
 * Reads an ontology from the library (or any Turtle file meant to sit next to the project's own classes) as
 * `intoProject` places it, with the statements the canvas can't show kept as an import keeps them. What the file says
 * about itself as an ontology (its header) is left out, so the export still describes one ontology, the project's.
 */
export async function importIntoProject(text: string, project: { iri: string; namespaces: Namespace[] }, prefix: string): Promise<{ result: OwlImportResult; statements: KeptStatement[] }> {
  const result = intoProject(importOwl(text), project, prefix)
  const { store } = parseTurtle(text, result.iri)
  const headers = store.getSubjects(RDF + 'type', OWL + 'Ontology', null).filter((t) => t.termType === 'NamedNode').map((t) => `<${t.value}> `)
  const statements = (await keptStatementsOf(text, { iri: result.iri, nodes: result.nodes, edges: result.edges, kept: result.kept })).filter(
    (s) => !headers.some((h) => s.ntriples.startsWith(h)),
  )
  return { result, statements }
}
