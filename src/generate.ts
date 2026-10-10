import type { ClassNode, PropertyConstraint, RelationEdge } from './model'

/**
 * Starter SHACL constraints for a class, read from what is already drawn and stated about it:
 * - an arrow of an object property from the class: its values are instances of the target class
 *   (when the class's arrows of that property all point at one class);
 * - `p only C`: values are instances of C;
 * - `p some …`, `p min n`, `p exactly n`: at least 1 / n values;
 * - `p max n`, `p exactly n` without a filler, or p functional: at most n / 1 values;
 * - a data property listed on the class: its datatype, and at most one value when functional.
 *
 * Only what the OWL statement guarantees for every value is carried over, so a qualified `max n C`
 * (other values may be anything) gives no maxCount. The result turns OWL's open-world statements into
 * closed-world requirements on data, which is why the inspector offers it as a suggestion.
 * Properties that already have a constraint in `existing` are left out.
 */
export function suggestConstraints(nodeId: string, nodes: ClassNode[], edges: RelationEdge[], existing: PropertyConstraint[] = []): PropertyConstraint[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return []
  const properties = edges.filter((e) => e.data?.kind === 'objectProperty')
  const labelOf = (edgeId: string) => properties.find((e) => e.id === edgeId)?.data?.label
  // Edges with the same label are one property; a constraint names it by its first edge, as the inspector does.
  const firstEdge = (label: string) => properties.find((e) => e.data!.label === label)!.id

  const byLabel = new Map<string, PropertyConstraint & { path: { type: 'object' } }>()
  const forProperty = (label: string) => {
    let c = byLabel.get(label)
    if (!c) {
      c = { path: { type: 'object', property: firstEdge(label) } }
      byLabel.set(label, c)
    }
    return c
  }
  const atLeast = (c: PropertyConstraint, n: number) => (c.minCount = Math.max(c.minCount ?? 0, n))
  const atMost = (c: PropertyConstraint, n: number) => (c.maxCount = Math.min(c.maxCount ?? Infinity, n))

  // Arrows drawn from this class.
  const targets = new Map<string, Set<string>>()
  for (const e of properties) {
    if (e.source !== nodeId) continue
    if (!targets.has(e.data!.label)) targets.set(e.data!.label, new Set())
    targets.get(e.data!.label)!.add(e.target)
  }
  for (const [label, to] of targets) {
    const c = forProperty(label)
    if (to.size === 1) c.class = [...to][0]
  }

  // Restrictions this class is a subclass of (equivalence implies the same).
  for (const axiom of node.data.axioms ?? []) {
    const e = axiom.expression
    if (axiom.kind === 'disjointWith' || e.type !== 'restriction') continue
    const label = labelOf(e.property)
    if (label === undefined) continue
    const c = forProperty(label)
    const n = Math.max(0, Math.floor(e.n ?? 0))
    if (e.quantifier === 'only' && e.filler) c.class = e.filler
    if (e.quantifier === 'some') atLeast(c, 1)
    if (e.quantifier === 'min' || e.quantifier === 'exactly') atLeast(c, n)
    if ((e.quantifier === 'max' || e.quantifier === 'exactly') && !e.filler) atMost(c, n)
  }

  // Functional properties have at most one value; the characteristic may sit on any edge of the property.
  for (const [label, c] of byLabel) {
    if (properties.some((e) => e.data!.label === label && e.data!.characteristics?.includes('functional'))) atMost(c, 1)
  }

  const taken = new Set(existing.map((c) => (c.path.type === 'object' ? `o:${labelOf(c.path.property)}` : `d:${c.path.name}`)))
  const result: PropertyConstraint[] = [...byLabel].filter(([label]) => !taken.has(`o:${label}`)).map(([, c]) => c)
  for (const p of node.data.dataProperties ?? []) {
    if (!p.name.trim() || taken.has(`d:${p.name}`)) continue
    taken.add(`d:${p.name}`)
    result.push({ path: { type: 'data', name: p.name }, datatype: p.datatype || undefined, ...(p.functional && { maxCount: 1 }) })
  }
  return result
}
