export type Point = { x: number; y: number }

/**
 * A bent edge is a quadratic curve that passes through `midpoint(source, target) + bend`.
 * Storing the bend as an offset from the straight midpoint keeps the curve's shape
 * when either end moves, the way Excalidraw arrows keep their bend.
 */
export function bentPath(source: Point, target: Point, bend: Point): { d: string; through: Point } {
  const mid = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
  const through = { x: mid.x + bend.x, y: mid.y + bend.y }
  // A quadratic Bezier at t = 0.5 sits halfway between the chord midpoint and its control point.
  const control = { x: 2 * through.x - mid.x, y: 2 * through.y - mid.y }
  return { d: `M ${source.x},${source.y} Q ${control.x},${control.y} ${target.x},${target.y}`, through }
}

/** The bend that makes the curve pass through `point`. */
export function bendThrough(source: Point, target: Point, point: Point): Point {
  return { x: point.x - (source.x + target.x) / 2, y: point.y - (source.y + target.y) / 2 }
}
