import type { Namespace } from './model'
import { PREFIXES, shortName } from './vocab'

/**
 * Competency questions: what the ontology is meant to answer, each written as a SPARQL query, kept with the project
 * and run against the export to see whether the ontology (still) answers it. A question passes when its query has an
 * answer (ASK true, or at least one row), or, with `expect: 'none'`, when it has none, e.g. "no class lacks a label".
 * The idea follows the competency question runner of open-ontologies (https://github.com/fabio-rovai/open-ontologies, MIT).
 */
export type CompetencyQuestion = { id: string; question: string; sparql: string; expect?: 'none' }

export type QuestionResult =
  | { ok: boolean; kind: 'ask'; answer: boolean }
  | { ok: boolean; kind: 'select'; variables: string[]; rows: string[][]; total: number }
  | { ok: false; kind: 'error'; message: string }

/** The most rows of an answer kept for showing. */
export const MAX_ROWS = 20

/** PREFIX lines for the project's namespaces and the usual vocabularies, `:` being the ontology's own. */
export function prefixLines(base: string, namespaces: Namespace[]): string {
  const all: Record<string, string> = { ...PREFIXES, ...Object.fromEntries(namespaces.map((n) => [n.prefix, n.iri])), '': base }
  return Object.entries(all)
    .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
    .join('\n')
}

/** A new question to start from: the subclasses of a class, `:` being the ontology. */
export function newQuestion(className?: string): CompetencyQuestion {
  const target = className ? `:${className}` : 'owl:Thing'
  return {
    id: crypto.randomUUID(),
    question: className ? `What kinds of ${className} are there?` : 'What classes are there?',
    sparql: className ? `SELECT ?kind WHERE {\n  ?kind rdfs:subClassOf+ ${target} .\n}` : 'SELECT ?class WHERE {\n  ?class a owl:Class .\n}',
  }
}

type Term = { termType: string; value: string; language?: string }
type Engine = { Store: new () => { load(text: string, options: { format: string; base_iri?: string }): void; query(q: string): unknown } }

// Oxigraph (MIT or Apache-2.0) is several megabytes of WebAssembly, so it loads the first time a question runs.
let engine: Promise<Engine> | undefined
function loadEngine(): Promise<Engine> {
  engine ??= import('oxigraph').then(async (module) => {
    // The browser build exports an init function that fetches the WebAssembly; the Node build is ready as it is.
    const init = (module as unknown as { default?: unknown }).default
    if (typeof init === 'function') await (init as () => Promise<unknown>)()
    return module as unknown as Engine
  })
  return engine
}

/** Runs each question over `turtle` (the export), with the project's prefixes declared before its query. */
export async function runQuestions(questions: CompetencyQuestion[], turtle: string, base: string, namespaces: Namespace[]): Promise<Map<string, QuestionResult>> {
  const { Store } = await loadEngine()
  const store = new Store()
  store.load(turtle, { format: 'text/turtle', base_iri: base })
  const labels = new Map<string, string>()
  const label = (iri: string) => {
    if (!labels.has(iri)) {
      const found = store.query(`SELECT ?l WHERE { <${iri}> <http://www.w3.org/2000/01/rdf-schema#label> ?l } LIMIT 1`) as Map<string, Term>[]
      labels.set(iri, found[0]?.get('l')?.value ?? shortName(iri))
    }
    return labels.get(iri)!
  }
  const show = (t: Term | undefined) => (!t ? '' : t.termType === 'NamedNode' ? label(t.value) : t.termType === 'Literal' ? t.value : '[]')
  const prologue = prefixLines(base, namespaces)
  const results = new Map<string, QuestionResult>()
  for (const q of questions) {
    try {
      const answer = store.query(`${prologue}\n${q.sparql}`)
      if (typeof answer === 'boolean') {
        results.set(q.id, { ok: answer === (q.expect !== 'none'), kind: 'ask', answer })
      } else if (Array.isArray(answer) && (answer.length === 0 || answer[0] instanceof Map)) {
        const rows = answer as Map<string, Term>[]
        const variables = [...new Set(rows.flatMap((r) => [...r.keys()]))]
        results.set(q.id, {
          ok: (rows.length > 0) === (q.expect !== 'none'),
          kind: 'select',
          variables,
          rows: rows.slice(0, MAX_ROWS).map((r) => variables.map((v) => show(r.get(v)))),
          total: rows.length,
        })
      } else {
        results.set(q.id, { ok: false, kind: 'error', message: 'Use SELECT or ASK; CONSTRUCT and DESCRIBE have no answer to check.' })
      }
    } catch (error) {
      results.set(q.id, { ok: false, kind: 'error', message: String(error instanceof Error ? error.message : error) })
    }
  }
  return results
}

/** The questions kept in a project file, keeping only well-formed ones. */
export function readQuestions(data: unknown): CompetencyQuestion[] {
  if (!Array.isArray(data)) return []
  return data
    .filter((q) => q && typeof q.id === 'string' && typeof q.question === 'string' && typeof q.sparql === 'string')
    .map((q) => ({ id: q.id, question: q.question, sparql: q.sparql, ...(q.expect === 'none' && { expect: 'none' as const }) }))
}
