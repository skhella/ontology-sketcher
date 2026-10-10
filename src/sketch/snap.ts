import { Position } from '@xyflow/react'
import type { Point } from './curve'

/** Every class has one connection dot per side; the handle id is the side's name. */
export const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const

export type Box = { id: string; x: number; y: number; width: number; height: number }
export type Snap = { nodeId: string; side: Position; point: Point }

export function sidePoint(box: Box, side: Position): Point {
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
    const side = nearestSide(box, point)
    return { nodeId: box.id, side, point: sidePoint(box, side) }
  }
  return null
}

// Size of a class box before React Flow has measured it.
export const CLASS_WIDTH = 180
export const CLASS_HEIGHT = 64

type Placed = { id: string; position: Point; measured?: { width?: number; height?: number } }

export function boxOf(node: Placed): Box {
  const { width = CLASS_WIDTH, height = CLASS_HEIGHT } = node.measured ?? {}
  return { id: node.id, x: node.position.x, y: node.position.y, width, height }
}

/** React Flow reports the connection pointer relative to the canvas element; this converts it to flow coordinates. */
export function toFlowPoint(pointer: Point, [x, y, zoom]: [number, number, number]): Point {
  return { x: (pointer.x - x) / zoom, y: (pointer.y - y) / zoom }
}
