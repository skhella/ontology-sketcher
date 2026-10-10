import { getBezierPath, Position } from '@xyflow/react'

export type Point = { x: number; y: number }

// Which way a default bezier leaves its target handle.
const OUTWARD: Record<Position, Point> = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
}

/**
 * The line an edge draws between its two dots: React Flow's default bezier, or a bent curve once its midpoint was dragged.
 * `mid` is where the label sits; `towards` is a point the line heads for as it leaves the target.
 */
export function edgeLine(
  source: Point,
  sourcePosition: Position,
  target: Point,
  targetPosition: Position,
  bend: Point | undefined,
): { d: string; mid: Point; towards: Point } {
  if (bend) {
    const bent = bentPath(source, target, bend)
    return { d: bent.d, mid: bent.through, towards: bent.control }
  }
  const [d, x, y] = getBezierPath({ sourceX: source.x, sourceY: source.y, sourcePosition, targetX: target.x, targetY: target.y, targetPosition })
  return { d, mid: { x, y }, towards: { x: target.x + OUTWARD[targetPosition].x, y: target.y + OUTWARD[targetPosition].y } }
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
