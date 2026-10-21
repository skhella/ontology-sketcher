import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser, type Quad, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { importExcalidraw } from './excalidraw'
import { baseIriProblem, exportName, exportOwl, type OwlExport } from './export'
import { sampleOntology, type Ontology } from './model'
import { SH } from './shacl'

const OWL = 'http://www.w3.org/2002/07/owl#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const NOW = new Date('2026-10-21T18:00:00Z')

// Sketches the golden files in tests/semantics/golden were exported from, by the exporter before this change.
const enterprise: Ontology = JSON.parse(readFileSync('tests/semantics/fixtures/enterprise.sketch.json', 'utf8'))
const pizza: Ontology = { iri: 'https://w3id.org/pizza-example#', ...importExcalidraw(readFileSync('docs/pizza-example.excalidraw', 'utf8')) }
const golden = (name: string) => readFileSync(`tests/semantics/golden/${name}.before.ttl`, 'utf8')

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

/** Per target class: property → the classes or datatypes its shape allows, as in `sh:class` or `sh:or ( [ sh:class … ] … )`. */
function allowedValues(shapes: string): Record<string, Record<string, string[]>> {
  const quads = new Parser().parse(shapes)
  const objects = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
  const list = (head: string): string[] => (head === RDF + 'nil' ? [] : [objects(head, RDF + 'first')[0], ...list(objects(head, RDF + 'rest')[0])])
  const out: Record<string, Record<string, string[]>> = {}
  for (const q of quads.filter((q) => q.predicate.value === SH + 'targetClass')) {
    for (const property of objects(q.subject.value, SH + 'property')) {
      const path = objects(property, SH + 'path')[0]
      const or = objects(property, SH + 'or')[0]
      const values = or
        ? list(or).flatMap((m) => [...objects(m, SH + 'class'), ...objects(m, SH + 'datatype')])
        : [...objects(property, SH + 'class'), ...objects(property, SH + 'datatype')]
      out[q.object.value] = { ...out[q.object.value], [path]: values }
    }
  }
  return out
}

describe('baseIriProblem', () => {
  it('accepts an IRI the user set and stops the export otherwise', () => {
    expect(baseIriProblem('https://w3id.org/plant-example#')).toBeNull()
    expect(baseIriProblem('urn:example:plant/')).toBeNull()
    expect(baseIriProblem('')).toMatch(/Set the Ontology IRI/)
    expect(baseIriProblem('  ')).toMatch(/Set the Ontology IRI/)
    expect(baseIriProblem('plant#')).toMatch(/not an absolute IRI/)
    expect(baseIriProblem('https://w3id.org/plant')).toMatch(/end with # or \//)
    // The placeholders the app starts with, or makes up for an imported drawing, never reach a file.
    expect(baseIriProblem(sampleOntology.iri)).toMatch(/placeholder/)
    expect(baseIriProblem('http://example.org/2026-08-12-city-map#')).toMatch(/placeholder/)
  })
})

describe('exportOwl', () => {
  it('fails without a base IRI instead of making one up', async () => {
    await expect(exportOwl({ ...enterprise, iri: '' }, 'plant.sketcher.json')).rejects.toThrow(/Set the Ontology IRI/)
    await expect(exportOwl(sampleOntology, 'pizza.sketcher.json')).rejects.toThrow(/placeholder/)
  })

  it('names both files after the sketch and writes the header', async () => {
    const { ontology, shapes } = await exportOwl(enterprise, 'plant.sketcher.json', { now: NOW })
    expect(ontology.name).toBe('plant.ttl')
    expect(shapes?.name).toBe('plant-shapes.ttl')
    expect(exportName('2026-08-12 - City Map.excalidraw')).toBe('2026-08-12-City-Map')
    expect(exportName('.sketcher.json')).toBe('ontology')

    const header = (p: string) =>
      new Parser().parse(ontology.text).filter((q) => q.subject.value === 'https://w3id.org/plant-example' && q.predicate.value === p).map((q) => q.object.value)
    expect(header(RDF + 'type')).toEqual([OWL + 'Ontology'])
    expect(header(OWL + 'versionInfo')).toEqual(['2026-10-21T18:00:00.000Z'])
    expect(header(RDFS + 'comment')).toEqual(['Exported by Ontology Sketcher from the sketch plant.sketcher.json. Rules for instance data are in plant-shapes.ttl.'])
    // Ontology and shapes share the base; the shapes live under /shapes.
    expect(shapes!.text).toContain('@prefix : <https://w3id.org/plant-example#>.')
    expect(shapes!.text).toContain('@prefix shape: <https://w3id.org/plant-example/shapes#>.')
  })

  it('has no shapes file when nothing makes a rule', async () => {
    const hierarchy = { ...enterprise, edges: enterprise.edges.filter((e) => e.data?.kind === 'subClassOf'), nodes: enterprise.nodes.map((n) => ({ ...n, data: { label: n.data.label } })) }
    expect((await exportOwl(hierarchy, 'plant.sketcher.json')).shapes).toBeNull()
  })

  for (const [name, sketch] of [['enterprise', enterprise], ['pizza-example', pizza]] as const) {
    describe(`the ${name} sketch`, () => {
      const files = () => exportOwl(sketch, `${name}.sketcher.json`, { now: NOW })

      it('writes an ontology without restrictions, domains, ranges or unions', async () => {
        const { ontology } = await files()
        for (const term of ['owl:Restriction', 'owl:allValuesFrom', 'rdfs:domain', 'rdfs:range', 'owl:unionOf']) expect(ontology.text).not.toContain(term)
        const predicates = new Set(new Parser().parse(ontology.text).flatMap((q) => [q.predicate.value, q.object.value]))
        for (const iri of [OWL + 'Restriction', OWL + 'allValuesFrom', RDFS + 'domain', RDFS + 'range', OWL + 'unionOf']) expect(predicates.has(iri)).toBe(false)
      })

      it('keeps the class and property inventory of the old export; only restrictions and domain/range moved', async () => {
        const { ontology } = await files()
        const moved = (line: string) => / http:\/\/www.w3.org\/2000\/01\/rdf-schema#(domain|range) /.test(line) || line.includes(OWL + 'Restriction')
        const header = (line: string) => line.includes(OWL + 'versionInfo') || line.startsWith(`${sketch.iri.replace(/#$/, '')} ${RDFS}comment`)
        expect(canonical(ontology.text).filter((l) => !header(l))).toEqual(canonical(golden(name)).filter((l) => !moved(l)))
      })

      it('writes each class’s drawn targets and datatypes as sh:class, sh:datatype or sh:or, with no counts', async () => {
        const { shapes } = await files()
        // What the old export said, per source class: its own allValuesFrom targets, or the property's range.
        const old = new Parser().parse(golden(name))
        const objects = (s: string, p: string) => old.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
        const list = (head: string): string[] => (head === RDF + 'nil' ? [] : [objects(head, RDF + 'first')[0], ...list(objects(head, RDF + 'rest')[0])])
        const members = (term: string) => (term.startsWith('http') ? [term] : list(objects(term, OWL + 'unionOf')[0]))
        const expected: Record<string, Record<string, string[]>> = {}
        for (const q of old.filter((q) => q.predicate.value === RDFS + 'domain')) {
          const range = members(objects(q.subject.value, RDFS + 'range')[0] ?? '')
          for (const source of members(q.object.value)) {
            const restriction = objects(source, RDFS + 'subClassOf').find((r) => objects(r, OWL + 'onProperty')[0] === q.subject.value)
            const targets = restriction ? members(objects(restriction, OWL + 'allValuesFrom')[0]) : range
            expected[source] = { ...expected[source], [q.subject.value]: targets }
          }
        }
        expect(Object.keys(expected).length).toBeGreaterThan(0)
        expect(allowedValues(shapes!.text)).toEqual(expected)
        expect(shapes!.text).not.toMatch(/minCount|maxCount|qualified/)
      })
    })
  }

  it('names the class, the property and the allowed targets in each message', async () => {
    const { shapes } = await exportOwl(enterprise, 'plant.sketcher.json')
    const messages = new Parser().parse(shapes!.text).filter((q) => q.predicate.value === SH + 'message').map((q) => q.object.value).sort()
    expect(messages).toEqual([
      'Enterprise hasPart: every value must be an instance of OrganizationalUnit or Site.',
      'Enterprise legalName: every value must be xsd:string.',
      'TechnicalItem hasPart: every value must be an instance of Component.',
      'TechnicalItem locatedAt: every value must be an instance of Site.',
    ])
  })

  // For tests/semantics/check.py: writes the exports there when it asks for them.
  it.runIf(!!process.env.SEMANTICS_OUT)('writes the exports for the Python checks', async () => {
    const out = process.env.SEMANTICS_OUT!
    mkdirSync(out, { recursive: true })
    for (const [name, sketch] of [['enterprise', enterprise], ['pizza-example', pizza]] as const) {
      const { ontology, shapes }: OwlExport = await exportOwl(sketch, `${name}.sketcher.json`, { now: NOW })
      writeFileSync(join(out, ontology.name), ontology.text)
      writeFileSync(join(out, shapes!.name), shapes!.text)
    }
  })
})
