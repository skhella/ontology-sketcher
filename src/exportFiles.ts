import { saveLayout } from './layout'
import type { KeptProperty, KeptStatement, Namespace } from './model'
import { toCypherScript } from './neo4j'
import { toTurtle } from './owl'
import { mergePages, type Workspace } from './pages'
import { hasConstraints, toShaclTurtle } from './shacl'

export type ExportFormat = 'owl' | 'cypher'
export type ExportFile = { name: string; label: string; type: string; text: string }
/** What every exported file shares besides its pages. */
export type ExportContext = { iri: string; namespaces: Namespace[]; kept: KeptProperty[]; keptStatements: KeptStatement[] }

/**
 * The files for the chosen pages merged into one ontology: ontology.ttl, plus shapes.ttl when any class has
 * constraints, or ontology.cypher for Neo4j. `page` names the files and their tabs after one page instead.
 */
export async function exportFiles(format: ExportFormat, ws: Workspace, pageIds: string[], context: ExportContext, page?: { stem: string; title: string }): Promise<ExportFile[]> {
  const { iri, namespaces, kept, keptStatements } = context
  const ontology = { ...mergePages(ws, pageIds, iri), namespaces, kept, keptStatements }
  // The OWL file carries the pages' layout so importing it draws them again; Neo4j gets plain OWL.
  const turtle = await toTurtle(ontology, format === 'owl' ? saveLayout(ws, pageIds, iri) : undefined)
  const shapes = hasConstraints(ontology) ? await toShaclTurtle(ontology) : null
  const label = (name: string, kind: string) => `${page?.title ?? name} (${kind})`
  if (format === 'cypher') {
    const name = `${page?.stem ?? 'ontology'}.cypher`
    return [{ name, label: label(name, 'Neo4j'), type: 'text/plain', text: toCypherScript({ iri: ontology.iri, ontology: turtle, shapes, namespaces }) }]
  }
  const owl = page ? `${page.stem}.ttl` : 'ontology.ttl'
  const shacl = page ? `${page.stem}.shapes.ttl` : 'shapes.ttl'
  return [
    { name: owl, label: label(owl, 'OWL'), type: 'text/turtle', text: turtle },
    ...(shapes ? [{ name: shacl, label: label(shacl, 'SHACL'), type: 'text/turtle', text: shapes }] : []),
  ]
}

/**
 * One export per page, as if only that page had been chosen: its classes and the relations drawn on it.
 * A class on several pages is written in full to each of their files.
 */
export async function exportFilesPerPage(format: ExportFormat, ws: Workspace, pageIds: string[], context: ExportContext): Promise<ExportFile[]> {
  const stems = pageFileStems(ws.pages)
  const chosen = ws.pages.filter((p) => pageIds.includes(p.id))
  return (await Promise.all(chosen.map((p) => exportFiles(format, ws, [p.id], context, { stem: stems.get(p.id)!, title: p.name })))).flat()
}

/** A file name without extension for each page, from its name; pages with the same name get -2, -3 and so on. */
export function pageFileStems(pages: { id: string; name: string }[]): Map<string, string> {
  const used = new Set<string>()
  const stems = new Map<string, string>()
  for (const page of pages) {
    const base = page.name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'page'
    let stem = base
    for (let n = 2; used.has(stem.toLowerCase()); n++) stem = `${base}-${n}`
    used.add(stem.toLowerCase())
    stems.set(page.id, stem)
  }
  return stems
}
