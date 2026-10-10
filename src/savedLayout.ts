import type { EdgeKind } from './model'
import type { Point } from './sketch/curve'
import type { SketchStyle } from './sketch/style'

/**
 * How the canvas drew an exported ontology, so importing the file brings back the same pages.
 * It travels in the Turtle export as one annotation on the ontology, a JSON string under
 * LAYOUT_PROPERTY: other tools ignore it, and the classes and properties themselves stay plain OWL.
 * Classes and arrows are named by IRI, so the layout still applies after the ontology was edited elsewhere.
 */
export const LAYOUT_PROPERTY = 'https://github.com/skhella/ontology-sketcher#layout'

export type SavedNode = { iri: string; x: number; y: number; style?: SketchStyle }
/** An arrow by its two classes' IRIs, its kind and its label (empty for subClassOf). */
export type SavedEdge = {
  source: string
  kind: EdgeKind
  label: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  style?: SketchStyle
  bend?: Point
}
export type SavedPage = { name: string; nodes: SavedNode[]; edges: SavedEdge[] }
export type SavedLayout = { version: 1; pages: SavedPage[] }

/** The key an arrow is matched by between the layout and the imported ontology. */
export function edgeKey(source: string, kind: string | undefined, label: string | undefined, target: string): string {
  return [source, kind ?? '', label ?? '', target].join(' ')
}

/** Reads a layout annotation; undefined when it is missing or not one this version understands. */
export function parseLayout(json: string | undefined): SavedLayout | undefined {
  if (!json) return undefined
  try {
    const layout = JSON.parse(json) as SavedLayout
    if (layout?.version !== 1 || !Array.isArray(layout.pages)) return undefined
    const pages = layout.pages.filter((p) => p && Array.isArray(p.nodes) && Array.isArray(p.edges))
    for (const p of pages) {
      p.name = typeof p.name === 'string' ? p.name : 'Page'
      p.nodes = p.nodes.filter((n) => typeof n?.iri === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))
      p.edges = p.edges.filter((e) => typeof e?.source === 'string' && typeof e.target === 'string' && typeof e.kind === 'string')
    }
    return { version: 1, pages }
  } catch {
    return undefined
  }
}
