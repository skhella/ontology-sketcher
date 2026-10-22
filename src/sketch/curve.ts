import { getBezierPath, Position } from '@xyflow/react'
import { isCorner, type Anchor } from './snap'

export type Point = { x: number; y: number }

// Which way a default bezier leaves each dot.
const OUTWARD: Record<Anchor, Point> = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  'top-right': { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  'bottom-right': { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  'bottom-left': { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  'top-left': { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
}

/**
 * The line an edge draws between its two dots: React Flow's default bezier, or a bent curve once its midpoint was dragged.
 * `mid` is where the label sits; `towards` is a point the line heads for as it leaves the target.
 */
export function edgeLine(
  source: Point,
  sourcePosition: Anchor,
  target: Point,
  targetPosition: Anchor,
  bend: Point | undefined,
): { d: string; mid: Point; towards: Point } {
  if (bend) {
    const bent = bentPath(source, target, bend)
    return { d: bent.d, mid: bent.through, towards: bent.control }
  }
  const towards = { x: target.x + OUTWARD[targetPosition].x, y: target.y + OUTWARD[targetPosition].y }
  if (isCorner(sourcePosition) || isCorner(targetPosition)) {
    const curve = diagonalBezier(source, OUTWARD[sourcePosition], target, OUTWARD[targetPosition])
    return { ...curve, towards }
  }
  const [d, x, y] = getBezierPath({ sourceX: source.x, sourceY: source.y, sourcePosition, targetX: target.x, targetY: target.y, targetPosition })
  return { d, mid: { x, y }, towards }
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * React Flow's default bezier, generalised to any outward direction so a corner dot's edge leaves diagonally.
 * Each control point sits along its dot's direction, half the distance to the other end, or a short loop back when the other end is behind it.
 */
export function diagonalBezier(source: Point, sourceOut: Point, target: Point, targetOut: Point): { d: string; mid: Point } {
  const offset = (from: Point, out: Point, to: Point) => {
    const ahead = (to.x - from.x) * out.x + (to.y - from.y) * out.y
    const reach = ahead >= 0 ? 0.5 * ahead : 0.25 * 25 * Math.sqrt(-ahead)
    return { x: round(from.x + out.x * reach), y: round(from.y + out.y * reach) }
  }
  const c1 = offset(source, sourceOut, target)
  const c2 = offset(target, targetOut, source)
  // A cubic at t = 0.5 is (p0 + 3 c1 + 3 c2 + p3) / 8.
  const mid = { x: (source.x + 3 * c1.x + 3 * c2.x + target.x) / 8, y: (source.y + 3 * c1.y + 3 * c2.y + target.y) / 8 }
  return { d: `M${source.x},${source.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${target.x},${target.y}`, mid }
}

/**
 * A bent edge is a quadratic curve that passes through `midpoint(source, target) + bend`.
 * Storing the bend as an offset from the straight midpoint keeps the curve's shape
 * when either end moves, the way Excalidraw arrows keep their bend.
 */
export function bentPath(source: Point, target: Point, bend: Point): { d: string; through: Point; control: Point } {
  const mid = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
  const through = { x: mid.x + bend.x, y: mid.y + bend.y }
  // A quadratic Bezier at t = 0.5 sits halfway between the chord midpoint and its control point.
  const control = { x: 2 * through.x - mid.x, y: 2 * through.y - mid.y }
  return { d: `M ${source.x},${source.y} Q ${control.x},${control.y} ${target.x},${target.y}`, through, control }
}

/** The bend that makes the curve pass through `point`. */
export function bendThrough(source: Point, target: Point, point: Point): Point {
  return { x: point.x - (source.x + target.x) / 2, y: point.y - (source.y + target.y) / 2 }
}
