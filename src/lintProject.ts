import { exportFiles, type ExportContext } from './exportFiles'
import { lintOntology, type Finding } from './lint'
import { localName, propertyLocalName } from './model'
import { dataPropertyIri, entityIri } from './owl'
import type { Workspace } from './pages'

/** Where a finding's entity is drawn: a class, or the arrow of an object property, on a page. */
export type LintTarget = { pageId: string; nodeId?: string; edgeId?: string }

/** The findings for the whole project, read from the files an export of every page would write. */
export async function lintProject(ws: Workspace, context: ExportContext): Promise<Finding[]> {
  const files = await exportFiles('owl', ws, ws.pages.map((p) => p.id), context)
  const shapes = files.find((f) => f.name.endsWith('.shapes.ttl') || f.name === 'shapes.ttl')
  const outside = new Set(Object.values(ws.store.classes).filter((c) => c.outside).map((c) => entityIri(context.iri, c, localName(c.label))))
  return lintOntology(files[0].text, shapes?.text ?? null, context.iri, { outside })
}

/**
 * Where to show each class and property IRI, on `pageId` when it is drawn there, else on the first page that has it.
 * A data property shows its first class listing it. Properties kept from an import are drawn nowhere and are left out.
 */
export function lintTargets(ws: Workspace, base: string, pageId: string): Map<string, LintTarget> {
  const { classes, relations } = ws.store
  const pages = [...ws.pages].sort((a, b) => Number(b.id === pageId) - Number(a.id === pageId))
  const pageOfNode = (id: string) => pages.find((p) => p.nodes.some((n) => n.id === id))?.id
  const pageOfEdge = (id: string) => pages.find((p) => p.edges.some((e) => e.id === id))?.id
  const targets = new Map<string, LintTarget>()
  const set = (iri: string, target: LintTarget | undefined) => target && !targets.has(iri) && targets.set(iri, target)
  for (const [id, c] of Object.entries(classes)) {
    const page = pageOfNode(id)
    if (!page) continue
    set(entityIri(base, c, localName(c.label)), { pageId: page, nodeId: id })
    for (const p of c.dataProperties ?? []) set(dataPropertyIri(base, p), { pageId: page, nodeId: id })
  }
  for (const [id, r] of Object.entries(relations)) {
    const page = r.kind === 'objectProperty' ? pageOfEdge(id) : undefined
    if (page) set(entityIri(base, r, propertyLocalName(r.label)), { pageId: page, edgeId: id })
  }
  return targets
}
