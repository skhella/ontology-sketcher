import type { ClassNode, RelationEdge } from './model'
import { bendThrough, type Point } from './sketch/curve'
import { nearestSide } from './sketch/snap'
import type { FillStyle, SketchStyle, StrokeStyle } from './sketch/style'

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
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  strokeStyle?: string
  roughness?: number
  /** Arrow points, relative to x/y. */
  points?: [number, number][]
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
      data: { label: labelOf.get(e.id)!, style: styleOf(e) },
    })
  }
  const classIds = new Set(nodes.map((n) => n.id))
  const shapeById = new Map(live.filter((e) => classIds.has(e.id)).map((e) => [e.id, e]))

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
        ...handlesOf(e, shapeById.get(source)!, shapeById.get(target)!),
        data: { ...(label && !isSubClassOfLabel(label) ? { kind: 'objectProperty', label } : { kind: 'subClassOf', label: '' }), style: styleOf(e), bend: bendOf(e) },
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

/** True for "SCO" and for spellings of subClassOf such as "subclass of" or "rdfs:subClassOf". */
function isSubClassOfLabel(label: string): boolean {
  return /^(sco|(rdfs:)?sub ?class ?of)$/i.test(label.trim())
}

/** Attaches each end to the dot on the side of the class where the arrow touched the original shape. */
function handlesOf(arrow: ExcalidrawElement, from: ExcalidrawElement, to: ExcalidrawElement) {
  const points = arrow.points
  if (!Array.isArray(points) || points.length < 2) return {}
  const [first, last] = [points[0], points[points.length - 1]]
  const box = (e: ExcalidrawElement) => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height })
  return {
    sourceHandle: nearestSide(box(from), { x: arrow.x + first[0], y: arrow.y + first[1] }),
    targetHandle: nearestSide(box(to), { x: arrow.x + last[0], y: arrow.y + last[1] }),
  }
}

/** A curved Excalidraw arrow (three or more points) keeps its bend: the curve passes through its middle point. */
function bendOf(e: ExcalidrawElement): Point | undefined {
  const points = e.points
  if (!Array.isArray(points) || points.length < 3) return undefined
  const [first, middle, last] = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]
  const bend = bendThrough({ x: first[0], y: first[1] }, { x: last[0], y: last[1] }, { x: middle[0], y: middle[1] })
  return Math.hypot(bend.x, bend.y) < 1 ? undefined : bend
}

/** Carries over the element's colours, fill, stroke and sloppiness, keeping only values our canvas understands. */
function styleOf(e: ExcalidrawElement): SketchStyle {
  const style: SketchStyle = {}
  if (typeof e.strokeColor === 'string') style.stroke = e.strokeColor
  if (e.type !== 'arrow' && typeof e.backgroundColor === 'string') style.fill = e.backgroundColor
  // Excalidraw's zigzag fill has no rough.js twin in our panel; hachure is the closest.
  if (e.type !== 'arrow' && e.fillStyle) style.fillStyle = (['hachure', 'cross-hatch', 'solid'].includes(e.fillStyle) ? e.fillStyle : 'hachure') as FillStyle
  if (typeof e.strokeWidth === 'number') style.strokeWidth = e.strokeWidth
  if (e.strokeStyle && ['solid', 'dashed', 'dotted'].includes(e.strokeStyle)) style.strokeStyle = e.strokeStyle as StrokeStyle
  if (typeof e.roughness === 'number') style.roughness = e.roughness
  return style
}

export function describeImport({ classes, subClassOf, objectProperties, skipped }: ImportSummary): string {
  const parts = [`${classes} ${classes === 1 ? 'class' : 'classes'}`, `${subClassOf} subClassOf`, `${objectProperties} object ${objectProperties === 1 ? 'property' : 'properties'}`]
  const text = `Imported ${parts.join(', ')}.`
  return skipped ? `${text} Skipped ${skipped} other ${skipped === 1 ? 'element' : 'elements'} (free text, lines, unlabelled shapes or loose arrows).` : text
}
