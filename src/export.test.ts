import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser, type Quad, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { importExcalidraw } from './excalidraw'
import type { Ontology } from './model'
import { toTurtle } from './owl'
import { hasConstraints, SH, toShaclTurtle } from './shacl'

// The sketches the golden files in tests/semantics/golden were exported from.
const enterprise: Ontology = JSON.parse(readFileSync('tests/semantics/fixtures/enterprise.sketch.json', 'utf8'))
const pizza: Ontology = { iri: 'https://w3id.org/pizza-example#', ...importExcalidraw(readFileSync('docs/pizza-example.excalidraw', 'utf8')) }
const golden = (name: string) => readFileSync(`tests/semantics/golden/${name}.ttl`, 'utf8')

// The enterprise sketch with one constraint the user added in the inspector, so it has a shapes file.
const withConstraint: Ontology = {
  ...enterprise,
  nodes: enterprise.nodes.map((n) => (n.id === 'enterprise' ? { ...n, data: { ...n.data, constraints: [{ path: { type: 'data', name: 'legal name' }, minCount: 1 }] } } : n)),
}

/** Triples with blank nodes written out inline, sorted, so two files compare equal whatever order and names they use. */
function canonical(turtle: string): string[] {
  const quads = new Parser().parse(turtle)
  const bySubject = new Map<string, Quad[]>()
  for (const q of quads) bySubject.set(q.subject.value, [...(bySubject.get(q.subject.value) ?? []), q])
  const term = (t: Term): string =>
    t.termType === 'BlankNode'
      ? `[${(bySubject.get(t.value) ?? []).map((q) => `${q.predicate.value} ${term(q.object)}`).sort().join('; ')}]`
      : t.termType === 'Literal'
        ? JSON.stringify([t.value, t.language, t.datatype.value])
        : t.value
  return quads
    .filter((q) => q.subject.termType !== 'BlankNode')
    .map((q) => `${q.subject.value} ${q.predicate.value} ${term(q.object)}`)
    .sort()
}

describe('the OWL export', () => {
  for (const [name, sketch] of [['enterprise', enterprise], ['pizza-example', pizza]] as const) {
    it(`writes the ${name} sketch as OWL and RDFS, with its domains, ranges, unions and restrictions`, async () => {
      expect(canonical(await toTurtle(sketch))).toEqual(canonical(golden(name)))
    })
  }

  it('writes a shapes file only for constraints the user added', async () => {
    expect(hasConstraints(enterprise)).toBe(false)
    expect(hasConstraints(withConstraint)).toBe(true)
    const shapes = new Parser().parse(await toShaclTurtle(withConstraint))
    expect(shapes.filter((q) => q.predicate.value === SH + 'property')).toHaveLength(1)
    expect(shapes.filter((q) => q.predicate.value === SH + 'class')).toHaveLength(0)
  })

  // For tests/semantics/check.py: writes the exports there when it asks for them.
  it.runIf(!!process.env.SEMANTICS_OUT)('writes the exports for the Python checks', async () => {
    const out = process.env.SEMANTICS_OUT!
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'enterprise.ttl'), await toTurtle(enterprise))
    writeFileSync(join(out, 'pizza-example.ttl'), await toTurtle(pizza))
    writeFileSync(join(out, 'enterprise-constraint-shapes.ttl'), await toShaclTurtle(withConstraint))
  })
})
