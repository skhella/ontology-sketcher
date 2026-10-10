import type { ClassNode, RelationEdge } from './model'

/** The subset of an Excalidraw element this importer reads. */
type ExcalidrawElement = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  isDeleted?: boolean
  text?: string
  originalText?: string
  containerId?: string | null
  startBinding?: { elementId: string } | null
  endBinding?: { elementId: string } | null
}

export type ImportSummary = {
  classes: number
  subClassOf: number
  objectProperties: number
  /** Elements that had no ontology meaning: free text, lines, drawings, unlabelled shapes, arrows not bound at both ends. */
  skipped: number
}

export type ImportResult = { nodes: ClassNode[]; edges: RelationEdge[]; summary: ImportSummary }

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])

// Size of a class box on our canvas (see ClassNodeView); imported boxes are centred on the original shape.
const NODE_WIDTH = 180
const NODE_HEIGHT = 64

/**
 * Converts an .excalidraw file (or Excalidraw clipboard JSON) into canvas nodes and edges.
 * Labelled rectangles, ellipses and diamonds become classes; arrows bound to two of them
 * become subClassOf (start is the subclass) or, when the arrow has a label, an object property.
 */
export function importExcalidraw(json: string): ImportResult {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const elements = (doc as { elements?: unknown })?.elements
  if (!Array.isArray(elements)) throw new Error('This does not look like an Excalidraw file (no "elements" list).')

  const live = (elements as ExcalidrawElement[]).filter((e) => e && typeof e.id === 'string' && !e.isDeleted)

  // Text bound to a shape or arrow carries containerId; that is the element's label.
  const labelOf = new Map<string, string>()
  for (const e of live) {
    if (e.type !== 'text' || !e.containerId) continue
    const text = (e.originalText ?? e.text ?? '').replace(/\s+/g, ' ').trim()
    if (text) labelOf.set(e.containerId, text)
  }

  const nodes: ClassNode[] = []
  const edges: RelationEdge[] = []
  let skipped = 0

  for (const e of live) {
    if (!SHAPES.has(e.type) || !labelOf.has(e.id)) continue
    nodes.push({
      id: e.id,
      type: 'owlClass',
      position: { x: e.x + e.width / 2 - NODE_WIDTH / 2, y: e.y + e.height / 2 - NODE_HEIGHT / 2 },
      data: { label: labelOf.get(e.id)! },
    })
  }
  const classIds = new Set(nodes.map((n) => n.id))

  for (const e of live) {
    if (e.type === 'text' && e.containerId) continue // counted with its container below
    if (SHAPES.has(e.type) && classIds.has(e.id)) continue

    const source = e.startBinding?.elementId
    const target = e.endBinding?.elementId
    if (e.type === 'arrow' && source && target && classIds.has(source) && classIds.has(target)) {
      const label = labelOf.get(e.id) ?? ''
      edges.push({
        id: e.id,
        type: 'relation',
        source,
        target,
        data: label ? { kind: 'objectProperty', label } : { kind: 'subClassOf', label: '' },
      })
      continue
    }
    skipped++
  }
  return {
    nodes,
    edges,
    summary: {
      classes: nodes.length,
      subClassOf: edges.filter((e) => e.data?.kind === 'subClassOf').length,
      objectProperties: edges.filter((e) => e.data?.kind === 'objectProperty').length,
      skipped,
    },
  }
}

export function describeImport({ classes, subClassOf, objectProperties, skipped }: ImportSummary): string {
  const parts = [`${classes} ${classes === 1 ? 'class' : 'classes'}`, `${subClassOf} subClassOf`, `${objectProperties} object ${objectProperties === 1 ? 'property' : 'properties'}`]
  const text = `Imported ${parts.join(', ')}.`
  return skipped ? `${text} Skipped ${skipped} other ${skipped === 1 ? 'element' : 'elements'} (free text, lines, unlabelled shapes or loose arrows).` : text
}
