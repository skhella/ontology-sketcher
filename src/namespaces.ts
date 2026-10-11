import type { Namespace } from './model'
import type { Workspace } from './pages'
import { PREFIXES } from './vocab'

const PREFIX_NAME = /^[A-Za-z][\w.-]*$/

/**
 * The `@prefix` declarations for the project's namespaces: entries with a usable prefix and IRI that clash
 * neither with the ontology's own namespace nor with the built-in vocabularies (rdf, owl, xsd, …).
 */
export function namespacePrefixes(namespaces: Namespace[] | undefined, base: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { prefix, iri } of namespaces ?? []) {
    const p = prefix.trim()
    const i = iri.trim()
    if (!PREFIX_NAME.test(p) || !i || i === base || p in PREFIXES || p in out) continue
    out[p] = i
  }
  return out
}

/** The prefix a namespace IRI is listed under, if any. */
export function prefixOf(namespaces: Namespace[] | undefined, iri: string | undefined): string | undefined {
  return iri ? namespaces?.find((n) => n.iri === iri)?.prefix : undefined
}

/** A short unused prefix for a namespace IRI: http://example.org/rdl/ → rdl, else ns1, ns2, … */
export function suggestPrefix(iri: string, taken: Iterable<string>): string {
  const used = new Set([...taken, ...Object.keys(PREFIXES)])
  const last = (iri.replace(/[#/]+$/, '').split(/[/#:]/).pop() ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 12)
  if (/^[a-z]/.test(last) && !used.has(last)) return last
  for (let i = 1; ; i++) if (!used.has(`ns${i}`)) return `ns${i}`
}

/** Moves every class and relation in namespace `from` to `to`, after the namespace's IRI was edited. */
export function renameNamespace(workspace: Workspace, from: string, to: string): Workspace {
  const move = <T extends { namespace?: string }>(entities: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(entities).map(([id, e]) => [id, e.namespace === from ? { ...e, namespace: to } : e]))
  return { ...workspace, store: { classes: move(workspace.store.classes), relations: move(workspace.store.relations) } }
}

/** The current list plus namespaces an import found that it lacks; a clashing prefix gets a fresh one. */
export function mergeNamespaces(current: Namespace[], found: Namespace[]): Namespace[] {
  const out = [...current]
  for (const n of found) {
    if (out.some((o) => o.iri === n.iri)) continue
    const taken = out.map((o) => o.prefix)
    out.push({ prefix: taken.includes(n.prefix) ? suggestPrefix(n.iri, taken) : n.prefix, iri: n.iri })
  }
  return out
}
