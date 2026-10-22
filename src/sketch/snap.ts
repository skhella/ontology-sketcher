import { Position } from '@xyflow/react'
import type { Point } from './curve'

/** The four side midpoints. Auto-layout and the Excalidraw import attach edges to these only. */
export const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const

/** The diagonal dots: a box's corners, or the points at 45° round an oval. */
export const CORNERS = ['top-right', 'bottom-right', 'bottom-left', 'top-left'] as const
export type Corner = (typeof CORNERS)[number]

/** Every class has eight connection dots, clockwise from the top; the handle id is the anchor's name. */
export type Anchor = Position | Corner
export const ANCHORS: readonly Anchor[] = [
  Position.Top,
  'top-right',
  Position.Right,
  'bottom-right',
  Position.Bottom,
  'bottom-left',
  Position.Left,
  'top-left',
]

export function isCorner(anchor: string | null | undefined): anchor is Corner {
  return (CORNERS as readonly string[]).includes(anchor ?? '')
}

/** A saved handle id as an anchor; ids this version does not know fall back to `fallback`. */
export function toAnchor(id: string | null | undefined, fallback: Anchor): Anchor {
  return (ANCHORS as readonly string[]).includes(id ?? '') ? (id as Anchor) : fallback
}

/** React Flow only knows four handle positions, so a corner dot reports the side it sits on (top or bottom). */
export function handlePosition(anchor: Anchor): Position {
  return isCorner(anchor) ? (anchor.startsWith('top') ? Position.Top : Position.Bottom) : anchor
}

// An oval's diagonal dots sit at 45° on the ellipse: (1 - 1/√2) / 2 of the way in from each edge.
const OVAL_INSET = (1 - Math.SQRT1_2) / 2

/** Where a corner dot sits, as fractions of the class's width and height. */
export function cornerFraction(corner: Corner, oval: boolean): Point {
  const inset = oval ? OVAL_INSET : 0
  return { x: corner.endsWith('left') ? inset : 1 - inset, y: corner.startsWith('top') ? inset : 1 - inset }
}

export type Box = { id: string; x: number; y: number; width: number; height: number; oval?: boolean }
export type Snap = { nodeId: string; side: Anchor; point: Point }

export function sidePoint(box: Box, side: Anchor): Point {
  if (isCorner(side)) {
    const f = cornerFraction(side, box.oval ?? false)
    return { x: box.x + f.x * box.width, y: box.y + f.y * box.height }
  }
  switch (side) {
    case Position.Top:
      return { x: box.x + box.width / 2, y: box.y }
    case Position.Bottom:
      return { x: box.x + box.width / 2, y: box.y + box.height }
    case Position.Left:
      return { x: box.x, y: box.y + box.height / 2 }
    case Position.Right:
      return { x: box.x + box.width, y: box.y + box.height / 2 }
  }
}

/** The dot of `box` closest to `point`. */
export function nearestSide(box: Box, point: Point): Position {
  let best: Position = Position.Top
  let bestDistance = Infinity
  for (const side of SIDES) {
    const p = sidePoint(box, side)
    const distance = Math.hypot(p.x - point.x, p.y - point.y)
    if (distance < bestDistance) [best, bestDistance] = [side, distance]
  }
  return best
}

/** The dot of `box`, of all eight, closest to `point`. */
export function nearestAnchor(box: Box, point: Point): Anchor {
  let best: Anchor = Position.Top
  let bestDistance = Infinity
  for (const anchor of ANCHORS) {
    const p = sidePoint(box, anchor)
    const distance = Math.hypot(p.x - point.x, p.y - point.y)
    if (distance < bestDistance) [best, bestDistance] = [anchor, distance]
  }
  return best
}

/**
 * When a new edge is dragged over a class (anywhere on it, not just on a dot), it locks to that
 * class's dot nearest the pointer. Returns null when the pointer is not over another class.
 */
export function snapToClass(boxes: Box[], point: Point, fromNodeId: string): Snap | null {
  // Topmost (last drawn) class wins when classes overlap.
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]
    if (box.id === fromNodeId) continue
    const inside = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
    if (!inside) continue
    const side = nearestAnchor(box, point)
    return { nodeId: box.id, side, point: sidePoint(box, side) }
  }
  return null
}

// Size of a class box before React Flow has measured it.
export const CLASS_WIDTH = 180
export const CLASS_HEIGHT = 64

type Placed = { id: string; position: Point; measured?: { width?: number; height?: number }; data?: { style?: { shape?: string } } }

export function boxOf(node: Placed): Box {
  const { width = CLASS_WIDTH, height = CLASS_HEIGHT } = node.measured ?? {}
  return { id: node.id, x: node.position.x, y: node.position.y, width, height, oval: node.data?.style?.shape === 'oval' }
}

/** React Flow reports the connection pointer relative to the canvas element; this converts it to flow coordinates. */
export function toFlowPoint(pointer: Point, [x, y, zoom]: [number, number, number]): Point {
  return { x: (pointer.x - x) / zoom, y: (pointer.y - y) / zoom }
}
