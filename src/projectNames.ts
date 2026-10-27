import { localName, propertyLocalName, type KeptProperty, type Namespace } from './model'
import { dataPropertyIri, entityIri } from './owl'
import type { Workspace } from './pages'
import { expandIri, PREFIXES, shortName } from './vocab'

/**
 * How text such as a Manchester syntax axiom names the project's classes, properties and individuals: by label
 * when that label is theirs alone, else prefix:local (a project namespace or a standard one), else the full IRI in <>.
 * `resolve` reads any of these back, and also the local name of an IRI in the ontology's namespace.
 */
export function projectNames(ws: Workspace, base: string, namespaces: Namespace[], kept: KeptProperty[]): { name: (iri: string) => string; resolve: (text: string) => string | undefined } {
  const labelled: [string, string][] = []
  for (const c of Object.values(ws.store.classes)) {
    labelled.push([entityIri(base, c, localName(c.label)), c.label])
    for (const p of c.dataProperties ?? []) if (p.name.trim()) labelled.push([dataPropertyIri(base, p), p.name])
  }
  for (const r of Object.values(ws.store.relations)) if (r.kind === 'objectProperty' && r.label) labelled.push([entityIri(base, r, propertyLocalName(r.label)), r.label])
  for (const p of kept) if (p.label) labelled.push([p.iri, p.label])

  const byLabel = new Map<string, Set<string>>()
  for (const [iri, label] of labelled) byLabel.set(label, new Set([...(byLabel.get(label) ?? []), iri]))
  const labelOf = new Map<string, string>()
  for (const [iri, label] of labelled) if (byLabel.get(label)!.size === 1 && !labelOf.has(iri)) labelOf.set(iri, label)
  const known = new Set(labelled.map(([iri]) => iri))
  const prefixes: [string, string][] = [...namespaces.map((n) => [n.prefix, n.iri] as [string, string]), ...Object.entries(PREFIXES)]

  const name = (iri: string) => {
    const label = labelOf.get(iri)
    if (label) return label
    if (iri.startsWith(base) && iri.length > base.length) return `:${iri.slice(base.length)}`
    const prefixed = prefixes.find(([, ns]) => iri.startsWith(ns) && iri.length > ns.length)
    if (prefixed) return `${prefixed[0]}:${iri.slice(prefixed[1].length)}`
    return shortName(iri) !== iri ? shortName(iri) : `<${iri}>`
  }
  const resolve = (text: string) => {
    const t = text.trim()
    const labelledIris = byLabel.get(t)
    if (labelledIris?.size === 1) return [...labelledIris][0]
    if (t.startsWith(':')) return base + t.slice(1)
    const colon = t.indexOf(':')
    const ns = colon > 0 ? prefixes.find(([p]) => p === t.slice(0, colon)) : undefined
    if (ns) return ns[1] + t.slice(colon + 1)
    const iri = expandIri(t, base)
    return known.has(iri) || iri !== base + t ? iri : undefined
  }
  return { name, resolve }
}
