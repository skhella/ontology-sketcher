import { DataFactory, Store, type Quad, type Term } from 'n3'
import { localName, propertyLocalName, type ClassNode, type PropertyConstraint, type RelationEdge } from './model'
import { entityIri } from './owl'
import { SH } from './shacl'
import { describe, parseTurtle, writeTurtle } from './turtle'
import { RDF, shortName } from './vocab'

const { namedNode } = DataFactory

/** What a shapes file gives one class: editable constraint rows, and the rest as Turtle kept for export. */
export type ImportedShapes = { constraints: PropertyConstraint[]; extra?: string }

export type ShapesImport = {
  /** By class node id, for every class some shape in the file targets. */
  classes: Map<string, ImportedShapes>
  /** Constraints read into rows, and rules kept as Turtle because the inspector can't edit them. */
  rows: number
  kept: number
  /** Shapes left out, with why, e.g. "PersonShape (targets Person, not on this page)". */
  skipped: string[]
}

// What a property shape may say and still become an editable row; anything else keeps it as Turtle.
const ROW_PREDICATES = new Set([RDF + 'type', SH + 'path', SH + 'minCount', SH + 'maxCount', SH + 'class', SH + 'datatype', SH + 'message'])
// What a node shape may say and still be split into rows and kept property shapes.
const SHAPE_PREDICATES = new Set([RDF + 'type', SH + 'targetClass', SH + 'property'])

/**
 * Reads a SHACL shapes file (Turtle) onto the classes on the canvas: each node shape targeting a class
 * becomes Constraints rows on it, for the rules the inspector can edit (counts, value class or datatype, message).
 * Everything else about a shape, such as sh:or, sh:pattern or property paths, is kept as Turtle on the class
 * and exported unchanged, so nothing is lost on a round trip. Shapes targeting no class on the canvas are skipped.
 * Throws the parser's error when the file is not valid Turtle.
 */
export async function importShapes(turtle: string, base: string, nodes: ClassNode[], edges: RelationEdge[]): Promise<ShapesImport> {
  const { store, prefixes } = parseTurtle(turtle, base)
  const classes = nodes.filter((n) => !n.data.kind)
  const classOf = new Map(classes.map((n) => [entityIri(base, n.data, localName(n.data.label)), n.id]))
  const objectProperties = edges.filter((e) => e.data?.kind === 'objectProperty')
  const propertyIri = (e: RelationEdge) => entityIri(base, e.data!, propertyLocalName(e.data!.label))
  const dataProperties = new Map<string, string>()
  for (const n of classes) for (const p of n.data.dataProperties ?? []) if (p.name.trim()) dataProperties.set(base + propertyLocalName(p.name), p.name)

  const one = (subject: Term, predicate: string) => {
    const objects = store.getObjects(subject, namedNode(predicate), null)
    return objects.length === 1 ? objects[0] : undefined
  }
  // Shapes a kept shape refers to by IRI (sh:node, sh:property, inside sh:or…) are kept with it.
  const isShape = (term: Term) => store.getQuads(term, null, null, null).some((q) => q.predicate.value.startsWith(SH) || q.object.value.startsWith(SH))
  const count = (term: Term | undefined) => (term?.termType === 'Literal' && /^\d+$/.test(term.value) ? Number(term.value) : undefined)

  // The row for a property shape on class `classId`, or undefined when it says something a row can't hold.
  const toRow = (shape: Term, classId: string): PropertyConstraint | undefined => {
    const quads = store.getQuads(shape, null, null, null)
    if (quads.some((q) => !ROW_PREDICATES.has(q.predicate.value))) return undefined
    // A rule given twice, such as two messages in different languages, doesn't fit a row either.
    const rules = quads.filter((q) => q.predicate.value !== RDF + 'type').map((q) => q.predicate.value)
    if (new Set(rules).size !== rules.length) return undefined
    const path = one(shape, SH + 'path')
    if (path?.termType !== 'NamedNode') return undefined
    const row: Partial<PropertyConstraint> = {}
    for (const [field, predicate] of [['minCount', 'minCount'], ['maxCount', 'maxCount']] as const) {
      const term = one(shape, SH + predicate)
      if (term && count(term) === undefined) return undefined
      if (term) row[field] = count(term)
    }
    const message = one(shape, SH + 'message')
    if (message) {
      if (message.termType !== 'Literal') return undefined
      row.message = message.value
    }
    const valueClass = one(shape, SH + 'class')
    const datatype = one(shape, SH + 'datatype')
    const edge = objectProperties.find((e) => propertyIri(e) === path.value && e.source === classId) ?? objectProperties.find((e) => propertyIri(e) === path.value)
    if (edge && !datatype) {
      if (valueClass && (valueClass.termType !== 'NamedNode' || !classOf.has(valueClass.value))) return undefined
      return { path: { type: 'object', property: edge.id }, ...row, ...(valueClass && { class: classOf.get(valueClass.value) }) }
    }
    const name = dataProperties.get(path.value)
    if (name !== undefined && !valueClass && (!datatype || datatype.termType === 'NamedNode')) {
      return { path: { type: 'data', name }, ...row, ...(datatype && { datatype: datatype.value }) }
    }
    return undefined
  }

  const result: ShapesImport = { classes: new Map(), rows: 0, kept: 0, skipped: [] }
  const kept = new Map<string, Quad[]>()
  const keep = (classId: string, quads: Quad[]) => kept.set(classId, [...(kept.get(classId) ?? []), ...quads])
  const entry = (classId: string) => {
    if (!result.classes.has(classId)) result.classes.set(classId, { constraints: [] })
    return result.classes.get(classId)!
  }

  const shapes = new Map<string, Term>()
  for (const s of store.getSubjects(namedNode(RDF + 'type'), namedNode(SH + 'NodeShape'), null)) shapes.set(s.id, s)
  for (const s of store.getSubjects(namedNode(SH + 'targetClass'), null, null)) shapes.set(s.id, s)

  for (const shape of shapes.values()) {
    const name = shape.termType === 'NamedNode' ? shortName(shape.value) : 'An unnamed shape'
    const targets = store.getObjects(shape, namedNode(SH + 'targetClass'), null)
    const onCanvas = targets.filter((t) => classOf.has(t.value))
    for (const t of targets) if (!classOf.has(t.value)) result.skipped.push(`${name} (targets ${shortName(t.value)}, not on this page)`)
    if (targets.length === 0) result.skipped.push(`${name} (no sh:targetClass)`)
    if (onCanvas.length === 0) continue

    const quads = store.getQuads(shape, null, null, null)
    if (quads.some((q) => !SHAPE_PREDICATES.has(q.predicate.value))) {
      // Rules on the shape itself (sh:closed, sh:or, other targets…): keep the whole shape, on the first class it targets.
      const classId = classOf.get(onCanvas[0].value)!
      entry(classId)
      keep(classId, describe(store, shape, isShape))
      result.kept += 1
      continue
    }
    for (const target of onCanvas) {
      const classId = classOf.get(target.value)!
      const into = entry(classId)
      for (const property of store.getObjects(shape, namedNode(SH + 'property'), null)) {
        const row = toRow(property, classId)
        if (row) {
          into.constraints.push(row)
          result.rows += 1
        } else {
          // Kept as its own shape on this class: a class's shapes all apply, so this adds the same rule.
          const link = [
            DataFactory.quad(shape as Quad['subject'], namedNode(RDF + 'type'), namedNode(SH + 'NodeShape')),
            DataFactory.quad(shape as Quad['subject'], namedNode(SH + 'targetClass'), target as Quad['object']),
            DataFactory.quad(shape as Quad['subject'], namedNode(SH + 'property'), property as Quad['object']),
          ]
          keep(classId, [...link, ...describe(store, property, isShape)])
          result.kept += 1
        }
      }
    }
  }

  // A Store drops the triples two kept parts share, such as a node shape's type and target.
  for (const [classId, quads] of kept) entry(classId).extra = await writeTurtle(new Store(quads).getQuads(null, null, null, null), { sh: SH, ...prefixes })
  return result
}

/** One line for the notice after an import. */
export function describeShapesImport({ classes, rows, kept, skipped }: ShapesImport): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const parts = [`Imported ${plural(rows, 'constraint', 'constraints')} on ${plural(classes.size, 'class', 'classes')}.`]
  if (kept > 0) parts.push(`Kept ${plural(kept, 'rule', 'rules')} the inspector can't edit yet; ${kept === 1 ? 'it exports' : 'they export'} unchanged.`)
  if (skipped.length > 0) parts.push(`Skipped ${skipped.join(', ')}.`)
  return parts.join(' ')
}
