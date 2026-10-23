import { Parser } from 'n3'
import { localName, propertyLocalName, type KeptProperty, type KeptStatement } from './model'
import { dataPropertyIri, entityIri } from './owl'
import type { Workspace } from './pages'
import { RDFS, shortName } from './vocab'

/**
 * The object and data properties of a project as a tree by rdfs:subPropertyOf, like Protégé's property hierarchy.
 * It reads what the export writes: properties drawn as arrows, data properties listed on classes, properties kept
 * from an import, and subPropertyOf statements kept from an import (such as a parent from another ontology).
 */

export type PropertyEntry = {
  iri: string
  kind: 'object' | 'data'
  label: string
  /** Labels of the domain and range classes, or compact datatype IRIs; several are alternatives (a union). */
  domains: string[]
  ranges: string[]
  /** Pages that draw the property, or show a class listing it; empty for a property kept from an import. */
  pages: { id: string; name: string }[]
  /** Kept from an import, not drawn on any page. */
  kept?: boolean
  /** Only named as a parent: the property is declared in another ontology, e.g. BFO's part of. */
  outside?: boolean
  parents: string[]
}

export type PropertyTree = { entry: PropertyEntry; children: PropertyTree[] }

type Context = { iri: string; kept?: KeptProperty[]; keptStatements?: KeptStatement[] }

/** Every property of the project by IRI, parents included. */
export function propertyEntries(workspace: Workspace, { iri: base, kept = [], keptStatements = [] }: Context): Map<string, PropertyEntry> {
  const { classes, relations } = workspace.store
  const entries = new Map<string, PropertyEntry>()
  const classIri = new Map(Object.entries(classes).map(([id, c]) => [id, entityIri(base, c, localName(c.label))]))
  const classLabel = new Map([...classIri].map(([id, i]) => [i, classes[id].label]))
  const nameOf = (i: string) => classLabel.get(i) ?? shortName(i)
  const add = (list: string[], item: string) => list.includes(item) || list.push(item)
  const entry = (iri: string, kind: PropertyEntry['kind'], label: string) => {
    let e = entries.get(iri)
    if (!e) {
      e = { iri, kind, label, domains: [], ranges: [], pages: [], parents: [] }
      entries.set(iri, e)
    }
    return e
  }

  const relationIri = new Map<string, string>()
  for (const [id, r] of Object.entries(relations)) {
    if (r.kind === 'objectProperty') relationIri.set(id, entityIri(base, r, propertyLocalName(r.label)))
  }
  for (const [id, r] of Object.entries(relations)) {
    const i = relationIri.get(id)
    if (!i) continue
    const e = entry(i, 'object', r.label)
    add(e.domains, classes[r.source]?.label ?? '?')
    add(e.ranges, classes[r.target]?.label ?? '?')
    const parent = r.subPropertyOf && relationIri.get(r.subPropertyOf)
    if (parent && parent !== i) add(e.parents, parent)
  }
  for (const c of Object.values(classes)) {
    for (const p of c.dataProperties ?? []) {
      if (!p.name.trim()) continue
      const e = entry(dataPropertyIri(base, p), 'data', p.name.trim())
      add(e.domains, c.label)
      if (p.datatype) add(e.ranges, shortName(p.datatype))
    }
  }
  // As in the export, a kept property the canvas now draws or lists under the same IRI is written from there.
  for (const p of kept) {
    if (entries.has(p.iri)) continue
    const e = entry(p.iri, p.kind, p.label.trim() || shortName(p.iri))
    e.kept = true
    for (const d of p.domains ?? []) add(e.domains, nameOf(d))
    for (const r of p.ranges ?? []) add(e.ranges, p.kind === 'object' ? nameOf(r) : shortName(r))
    for (const parent of p.subPropertyOf ?? []) add(e.parents, parent)
  }

  // Pages: an object property is on the pages placing one of its arrows, a data property on those placing a class listing it.
  for (const page of workspace.pages) {
    const ref = { id: page.id, name: page.name }
    const onPage = new Set<string>()
    for (const edge of page.edges) {
      const i = relationIri.get(edge.id)
      if (i) onPage.add(i)
    }
    for (const node of page.nodes) {
      for (const p of classes[node.id]?.dataProperties ?? []) if (p.name.trim()) onPage.add(dataPropertyIri(base, p))
    }
    for (const i of onPage) entries.get(i)?.pages.push(ref)
  }

  // Parents kept from an import, e.g. a drawn property's subPropertyOf a property of another ontology.
  for (const s of keptStatements) {
    if (!s.about || !entries.has(s.about) || !s.ntriples.includes(RDFS + 'subPropertyOf')) continue
    for (const q of new Parser({ format: 'N-Triples' }).parse(s.ntriples)) {
      if (q.subject.value === s.about && q.predicate.value === RDFS + 'subPropertyOf' && q.object.termType === 'NamedNode') {
        if (q.object.value !== s.about) add(entries.get(s.about)!.parents, q.object.value)
      }
    }
  }

  // Parents nothing in the project declares, shown so their children have somewhere to hang.
  for (const e of [...entries.values()]) {
    for (const parent of e.parents) {
      if (!entries.has(parent)) entries.set(parent, { iri: parent, kind: e.kind, label: shortName(parent), domains: [], ranges: [], pages: [], outside: true, parents: [] })
    }
  }
  return entries
}

/**
 * The entries of one kind as trees, sorted by label. A property with several parents appears under each of them.
 * A cycle of subPropertyOf is cut where it comes back round, and a cycle no root reaches starts at one of its members.
 */
export function propertyTrees(entries: Map<string, PropertyEntry>, kind: PropertyEntry['kind']): PropertyTree[] {
  const ofKind = [...entries.values()].filter((e) => e.kind === kind)
  const children = new Map<string, PropertyEntry[]>()
  for (const e of ofKind) for (const p of e.parents) children.set(p, [...(children.get(p) ?? []), e])
  const byLabel = (a: PropertyEntry, b: PropertyEntry) => a.label.localeCompare(b.label)
  const reached = new Set<string>()
  const grow = (entry: PropertyEntry, path: Set<string>): PropertyTree => {
    reached.add(entry.iri)
    const next = new Set([...path, entry.iri])
    const below = (children.get(entry.iri) ?? []).filter((c) => !next.has(c.iri)).sort(byLabel)
    return { entry, children: below.map((c) => grow(c, next)) }
  }
  const roots = ofKind.filter((e) => e.parents.every((p) => entries.get(p)?.kind !== kind)).sort(byLabel)
  const trees = roots.map((r) => grow(r, new Set()))
  for (const e of ofKind.sort(byLabel)) if (!reached.has(e.iri)) trees.push(grow(e, new Set()))
  return trees
}
