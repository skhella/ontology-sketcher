import { Position } from '@xyflow/react'
import type { ClassNode, RelationEdge } from './model'
import { edgeLine, type Point } from './sketch/curve'
import { breakPoints } from './sketch/label'
import { constraintOnArrow, multiplicity, nearTarget } from './sketch/multiplicity'
import { roughEllipse, roughPath, roughRect, seedFor, type SketchPath } from './sketch/rough'
import { boxOf, sidePoint, toAnchor, type Anchor, type Box } from './sketch/snap'
import { dashArray, EDGE_DEFAULTS, nodeStyle, roughNodeOptions } from './sketch/style'

/**
 * Draws a page as a standalone SVG image that looks like the canvas: the same rough.js outlines (same seeds),
 * labels, arrowheads, SKOS badges and SHACL counts, without selection, dots or other controls.
 * Text stays text, set in Excalifont; `fontCss` embeds the font so the file renders the same anywhere.
 */
export type SvgOptions = {
  /** Width of `text` at `fontSize` px in Excalifont, used to wrap class names as the canvas does. */
  measure: (text: string, fontSize: number) => number
  /** Where an edge starts or ends on a node, by the dot's id (its side); defaults to the middle of that side. */
  endpoint?: (node: ClassNode, side: Anchor) => Point
  /** @font-face rules to put in the file. */
  fontCss?: string
  /** Fill the image with the canvas colour; otherwise the background is transparent. */
  background?: boolean
  /** Draw it the way dark mode shows the canvas. */
  dark?: boolean
}

export const FONT_FAMILY = "Excalifont, 'Shantell Sans', 'Comic Sans MS', cursive"
// Label plates and the background are white; dark mode's filter turns white into the dark canvas colour.
const PAPER = 'white'
const DARK_PAPER = '#121212'
const PADDING = 24

// Sizes from index.css, so the image matches the canvas.
const CLASS_FONT = 20
const CLASS_LINE = 24
const BADGE_FONT = 12
const EDGE_FONT = 16
const COUNT_FONT = 14

/**
 * Dark mode inverts the viewport and turns the hue back (index.css: invert(93%) hue-rotate(180deg)).
 * The same as one colour matrix, which SVG viewers understand where CSS filters are not supported.
 */
function darkMatrix(): string {
  const hue = [
    [-0.574, 1.43, 0.144],
    [0.426, 0.43, 0.144],
    [0.426, 1.43, -0.856],
  ]
  // invert(a) maps c to a + (1 - 2a)c; each hue row sums to 1, so the offset stays a.
  const a = 0.93
  return hue.map((row) => [...row.map((v) => round(v * (1 - 2 * a))), 0, a].join(' ')).join(' ') + ' 0 0 0 1 0'
}

export function toSvg(nodes: ClassNode[], edges: RelationEdge[], options: SvgOptions): string {
  const { measure } = options
  const endpoint = options.endpoint ?? ((node, side) => sidePoint(boxOf(node), side))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const bounds = new Bounds()
  const edgeParts: string[] = []
  const labelParts: string[] = []
  const nodeParts: string[] = []

  for (const edge of edges) {
    const sourceNode = byId.get(edge.source)
    const targetNode = byId.get(edge.target)
    if (!sourceNode || !targetNode) continue
    const sourceSide = toAnchor(edge.sourceHandle, Position.Top)
    const targetSide = toAnchor(edge.targetHandle, Position.Bottom)
    const source = endpoint(sourceNode, sourceSide)
    const target = endpoint(targetNode, targetSide)
    const { d, mid, towards } = edgeLine(source, sourceSide, target, targetSide, edge.data?.bend)
    const kind = edge.data?.kind
    const style = { ...EDGE_DEFAULTS, ...edge.data?.style }
    const dash = dashArray(style.strokeStyle ?? (kind === 'subClassOf' ? 'solid' : 'dashed'), style.strokeWidth)
    const sketch = roughPath(d, { seed: seedFor(edge.id), roughness: style.roughness, stroke: style.stroke, strokeWidth: style.strokeWidth })
    edgeParts.push(...sketch.map((p) => pathTag(p, dash)))
    bounds.addPath(d, style.strokeWidth + 4)

    // The arrowhead React Flow's marker draws (a 20-unit view box at 18 × stroke width 1.5), as plain lines.
    const arrow = arrowhead(target, towards, 1.35)
    const closed = kind === 'subClassOf'
    edgeParts.push(
      `<polyline points="${arrow.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')}${closed ? ` ${round(arrow[0].x)},${round(arrow[0].y)}` : ''}" ` +
        `fill="${closed ? style.stroke : 'none'}" stroke="${style.stroke}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    arrow.forEach((p) => bounds.add(p, 2))

    const label = kind === 'subClassOf' ? 'subClassOf' : edge.data?.label
    if (label) labelParts.push(boxedText(label, mid, EDGE_FONT, 4, measure, bounds))

    if (kind === 'objectProperty') {
      const labelOf = (id: string) => edges.find((e) => e.id === id)?.data?.label
      const constraint = constraintOnArrow(sourceNode.data.constraints, edge.data?.label ?? '', labelOf)
      const counts = constraint && multiplicity(constraint)
      if (counts) labelParts.push(boxedText(counts, nearTarget(target, towards), COUNT_FONT, 3, measure, bounds))
    }
  }

  for (const node of nodes) {
    const box = boxOf(node)
    const { stroke, fill, strokeStyle, strokeWidth, shape } = nodeStyle(node.data.style)
    const oval = shape === 'oval'
    const outline: SketchPath[] = (oval ? roughEllipse : roughRect)(box.width, box.height, roughNodeOptions(node.data.style, seedFor(node.id)))
    const parts = outline.map((p, i) => pathTag(p, i === outline.length - 1 ? dashArray(strokeStyle, strokeWidth) : undefined))
    bounds.addBox(box, strokeWidth + 2)

    // The label's text area: the box less 8px padding a side, or the oval's inscribed width.
    const lines = wrap(node.data.label, box.width - (oval ? 56 : 16), (t) => measure(t, CLASS_FONT))
    const top = box.height / 2 - (lines.length * CLASS_LINE) / 2
    parts.push(
      `<text x="${box.width / 2}" font-size="${CLASS_FONT}" text-anchor="middle">` +
        lines.map((line, i) => `<tspan x="${box.width / 2}" y="${round(top + CLASS_LINE * (i + 0.5))}" dominant-baseline="central">${escapeXml(line)}</tspan>`).join('') +
        '</text>',
    )

    if (node.data.kind) {
      const width = measure(node.data.kind, BADGE_FONT) + 14
      const badgeFill = fill === 'transparent' ? PAPER : fill
      parts.push(
        `<rect x="12.5" y="-8.5" width="${round(width - 1)}" height="17" rx="8" fill="${badgeFill}" stroke="${stroke}"/>` +
          `<text x="${round(12 + width / 2)}" y="0" font-size="${BADGE_FONT}" text-anchor="middle" dominant-baseline="central" fill="${stroke}">${node.data.kind}</text>`,
      )
      bounds.addBox({ ...box, x: box.x + 12, y: box.y - 9, width, height: 18 }, 1)
    }
    nodeParts.push(`<g transform="translate(${round(box.x)},${round(box.y)})">${parts.join('')}</g>`)
  }

  const view = bounds.padded(PADDING)
  const dark = options.dark ?? false
  const filter = dark
    ? `<filter id="dark" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${darkMatrix()}"/></filter>`
    : ''
  const style = options.fontCss ? `<style>${options.fontCss}</style>` : ''
  const background = options.background
    ? `<rect x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" fill="${dark ? DARK_PAPER : PAPER}"/>`
    : ''
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}">`,
    `<defs>${style}${filter}</defs>`,
    background,
    `<g font-family="${FONT_FAMILY.replace(/"/g, '&quot;')}" fill="#1e1e1e"${dark ? ' filter="url(#dark)"' : ''}>`,
    // Edges under the classes, labels on top, as React Flow stacks them.
    `<g class="edges">${edgeParts.join('')}</g>`,
    `<g class="classes">${nodeParts.join('')}</g>`,
    `<g class="labels">${labelParts.join('')}</g>`,
    '</g>',
    '</svg>',
  ].join('\n')
}

/** Text on a small background-coloured plate, like the canvas's edge labels and counts. */
function boxedText(text: string, at: Point, fontSize: number, padding: number, measure: SvgOptions['measure'], bounds: Bounds): string {
  const width = measure(text, fontSize) + 2 * padding
  const height = Math.round(fontSize * 1.25)
  const box = { id: '', x: at.x - width / 2, y: at.y - height / 2, width, height }
  bounds.addBox(box, 0)
  return (
    `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(width)}" height="${height}" fill="${PAPER}"/>` +
    `<text x="${round(at.x)}" y="${round(at.y)}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(text)}</text>`
  )
}

function pathTag(p: SketchPath, dash: string | undefined): string {
  return `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
}

/** The three points of an open arrowhead at `tip`, pointing away from `towards`. */
export function arrowhead(tip: Point, towards: Point, scale: number): [Point, Point, Point] {
  const dx = tip.x - towards.x
  const dy = tip.y - towards.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const at = (back: number, side: number) => ({ x: tip.x + (-back * ux - side * uy) * scale, y: tip.y + (-back * uy + side * ux) * scale })
  return [at(5, -4), tip, at(5, 4)]
}

/**
 * Wraps a class name into lines no wider than `width`, as the canvas's label does: at spaces and the
 * label's break points (camelCase humps and the like), and mid-word only where a piece is still too wide.
 */
export function wrap(label: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  for (const [w, word] of label.trim().split(/\s+/).entries()) {
    for (const [p, piece] of breakPoints(word).entries()) {
      const joined = line + (w > 0 && p === 0 && line ? ' ' : '') + piece
      if (!line || measure(joined) <= width) {
        line = joined
      } else {
        lines.push(line)
        line = piece
      }
      // A piece wider than the whole line breaks anywhere.
      while (measure(line) > width && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut)) > width) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** The area everything drawn covers. */
class Bounds {
  private minX = Infinity
  private minY = Infinity
  private maxX = -Infinity
  private maxY = -Infinity

  add(p: Point, margin: number) {
    this.minX = Math.min(this.minX, p.x - margin)
    this.minY = Math.min(this.minY, p.y - margin)
    this.maxX = Math.max(this.maxX, p.x + margin)
    this.maxY = Math.max(this.maxY, p.y + margin)
  }

  addBox(box: Box, margin: number) {
    this.add({ x: box.x, y: box.y }, margin)
    this.add({ x: box.x + box.width, y: box.y + box.height }, margin)
  }

  /** Samples the M … C or M … Q path an edge draws (rough.js wobbles stay within the margin). */
  addPath(d: string, margin: number) {
    const n = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)
    const points: Point[] = []
    for (let i = 0; i + 1 < n.length; i += 2) points.push({ x: n[i], y: n[i + 1] })
    for (let t = 0; t <= 1; t += 0.05) {
      // De Casteljau over however many control points the path has.
      let level = points
      while (level.length > 1) level = level.slice(1).map((p, i) => ({ x: level[i].x + (p.x - level[i].x) * t, y: level[i].y + (p.y - level[i].y) * t }))
      if (level[0]) this.add(level[0], margin)
    }
  }

  padded(padding: number) {
    if (this.minX === Infinity) return { x: 0, y: 0, width: 2 * padding, height: 2 * padding }
    const x = Math.floor(this.minX - padding)
    const y = Math.floor(this.minY - padding)
    return { x, y, width: Math.ceil(this.maxX + padding) - x, height: Math.ceil(this.maxY + padding) - y }
  }
}

/** Excalifont's Latin Extended file is only worth embedding when a label uses one of its letters (see index.css). */
export function needsLatinExtended(text: string): boolean {
  return /[Ā-İĲ-žƒȘ-ț]/.test(text)
}
