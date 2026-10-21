import type { Ontology } from './model'
import { toTurtle } from './owl'
import type { SavedLayout } from './savedLayout'
import { hasShapes, toShaclTurtle } from './shacl'
import { isAbsoluteIri } from './vocab'

/**
 * The OWL and SHACL export as two files: <name>.ttl, the ontology (an inference-safe TBox, see owl.ts),
 * and <name>-shapes.ttl, the SHACL shapes (see shacl.ts), which both use the project's base IRI.
 */

export type ExportedFile = { name: string; text: string }
export type OwlExport = { ontology: ExportedFile; shapes: ExportedFile | null }

/**
 * Why `iri` can't be the base of an export, or null when it can. The base is the Ontology IRI the user sets
 * in the toolbar; it is never made up, so an empty one or the example.org placeholder the app starts with stops the export.
 */
export function baseIriProblem(iri: string): string | null {
  const base = iri.trim()
  if (!base) return 'Set the Ontology IRI in the toolbar first, e.g. https://w3id.org/my-ontology#. The export needs it as the base of every class and property.'
  if (!isAbsoluteIri(base)) return `The Ontology IRI "${base}" is not an absolute IRI. Set one like https://w3id.org/my-ontology# in the toolbar.`
  if (!/[#/]$/.test(base)) return `The Ontology IRI "${base}" should end with # or /, so class names can follow it.`
  if (/^https?:\/\/example\.(org|com|net)\//i.test(base))
    return `The Ontology IRI is still the placeholder ${base}. Set your own in the toolbar, e.g. https://w3id.org/my-ontology#.`
  return null
}

/** The file name stem: the sketch file's name without its extension, e.g. plant.sketcher.json → plant. */
export function exportName(sourceFile: string): string {
  const stem = sourceFile.replace(/\.(sketcher\.json|excalidraw|json|ttl|nt|owl)$/i, '')
  return stem.trim().replace(/[^\w.-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'ontology'
}

/**
 * Both files of the OWL and SHACL export. `sourceFile` is the sketch file the export comes from, named in the
 * ontology's rdfs:comment; `now` goes into owl:versionInfo. Throws with baseIriProblem's message when the base is unusable.
 */
export async function exportOwl(ontology: Ontology, sourceFile: string, options: { layout?: SavedLayout; now?: Date } = {}): Promise<OwlExport> {
  const problem = baseIriProblem(ontology.iri)
  if (problem) throw new Error(problem)
  const name = exportName(sourceFile)
  const shapes = hasShapes(ontology) ? { name: `${name}-shapes.ttl`, text: await toShaclTurtle(ontology) } : null
  const header = {
    versionInfo: (options.now ?? new Date()).toISOString(),
    comment: `Exported by Ontology Sketcher from the sketch ${sourceFile}.${shapes ? ` Rules for instance data are in ${shapes.name}.` : ''}`,
  }
  return { ontology: { name: `${name}.ttl`, text: await toTurtle(ontology, options.layout, header) }, shapes }
}
