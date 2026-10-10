import type { PropertyConstraint } from '../model'
import type { Point } from './curve'

/**
 * A constraint's counts in UML notation: `1..*` for at least one, `0..1` for at most one, `2` for exactly two.
 * Undefined when the constraint sets neither count.
 */
export function multiplicity(c: Pick<PropertyConstraint, 'minCount' | 'maxCount'>): string | undefined {
  if (c.minCount === undefined && c.maxCount === undefined) return undefined
  const min = c.minCount ?? 0
  if (c.maxCount === min) return String(min)
  return `${min}..${c.maxCount ?? '*'}`
}

/**
 * The constraint the source class puts on an arrow's object property, if any.
 * Constraints name a property by one of its edges and edges with the same label are one property,
 * so `labelOf` reads the label of the edge a constraint names.
 */
export function constraintOnArrow(
  constraints: PropertyConstraint[] | undefined,
  label: string,
  labelOf: (edgeId: string) => string | undefined,
): PropertyConstraint | undefined {
  return constraints?.find((c) => c.path.type === 'object' && labelOf(c.path.property) === label)
}

/**
 * Where a multiplicity sits: just off the arrowhead, back along the line and to one side, like UML.
 * `towards` is a point the line heads for as it leaves the target (its last control point).
 */
export function nearTarget(target: Point, towards: Point, along = 26, aside = 14): Point {
  const dx = towards.x - target.x
  const dy = towards.y - target.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  return { x: target.x + ux * along - uy * aside, y: target.y + uy * along + ux * aside }
}
