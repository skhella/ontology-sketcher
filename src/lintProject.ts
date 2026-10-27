import { exportFiles, type ExportContext } from './exportFiles'
import { lintOntology, type Finding } from './lint'
import { localName } from './model'
import { entityIri } from './owl'
import type { Workspace } from './pages'

/** The findings for the whole project, read from the files an export of every page would write. */
export async function lintProject(ws: Workspace, context: ExportContext): Promise<Finding[]> {
  const files = await exportFiles('owl', ws, ws.pages.map((p) => p.id), context)
  const shapes = files.find((f) => f.name.endsWith('.shapes.ttl') || f.name === 'shapes.ttl')
  const outside = new Set(Object.values(ws.store.classes).filter((c) => c.outside).map((c) => entityIri(context.iri, c, localName(c.label))))
  return lintOntology(files[0].text, shapes?.text ?? null, context.iri, { outside })
}
