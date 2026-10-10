import { describe, expect, it } from 'vitest'
import { sampleOntology, type ClassNode, type Ontology } from './model'
import { toShaclTurtle } from './shacl'
import { describeShapesImport, importShapes } from './shapesImport'
import { parseTurtle } from './turtle'
import { validateData } from './validate'

const P = 'http://example.org/pizza#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'

// The sample with a data property to constrain, and no constraints yet.
const base: Ontology = {
  ...sampleOntology,
  nodes: sampleOntology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, dataProperties: [{ name: 'name', datatype: XSD + 'string' }] } } : n)),
}

// Applies an import to the ontology the way the editor does.
async function imported(turtle: string): Promise<Ontology> {
  const result = await importShapes(turtle, base.iri, base.nodes, base.edges)
  const nodes = base.nodes.map((n): ClassNode => {
    const shapes = result.classes.get(n.id)
    return shapes ? { ...n, data: { ...n.data, constraints: shapes.constraints, extraShapes: shapes.extra } } : n
  })
  return { ...base, nodes }
}

const HEADER = `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <${XSD}> . @prefix : <${P}> . @prefix ex: <http://shapes.example/> .\n`

describe('importShapes', () => {
  it('reads an exported shapes file back into the same constraints', async () => {
    const constraints = [
      { path: { type: 'object' as const, property: 'e3' }, minCount: 1, class: 'topping', message: 'A pizza needs a topping.' },
      { path: { type: 'data' as const, name: 'name' }, maxCount: 1, datatype: XSD + 'string' },
    ]
    const ontology = { ...base, nodes: base.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, constraints } } : n)) }
    const result = await importShapes(await toShaclTurtle(ontology), base.iri, base.nodes, base.edges)

    expect([...result.classes.keys()]).toEqual(['pizza'])
    expect(result.classes.get('pizza')).toEqual({ constraints })
    expect(describeShapesImport(result)).toBe('Imported 2 constraints on 1 class.')
  })

  it('keeps what rows cannot hold as Turtle, exports it unchanged and still checks it', async () => {
    const ontology = await imported(
      HEADER +
        `ex:PizzaShape a sh:NodeShape ; sh:targetClass :Pizza ;
           sh:property [ sh:path :hasTopping ; sh:minCount 1 ] ;
           sh:property [ sh:path :name ; sh:pattern "^[A-Z]" ] ;
           sh:property ex:NameLength .
         ex:NameLength sh:path :name ; sh:maxLength 8 .
         ex:ToppingShape a sh:NodeShape ; sh:targetClass :Topping ; sh:closed true .
         ex:PersonShape a sh:NodeShape ; sh:targetClass :Person ; sh:property [ sh:path :name ; sh:minCount 1 ] .`,
    )
    const pizza = ontology.nodes.find((n) => n.id === 'pizza')!.data
    expect(pizza.constraints).toEqual([{ path: { type: 'object', property: 'e3' }, minCount: 1 }])
    expect(pizza.extraShapes).toContain('^[A-Z]')
    expect(ontology.nodes.find((n) => n.id === 'topping')!.data).toMatchObject({ constraints: [], extraShapes: expect.stringContaining('closed') })

    // The kept parts parse on their own, the named property shape comes with them, and they reach shapes.ttl.
    expect(parseTurtle(pizza.extraShapes!, base.iri).store.getQuads(null, null, null, null).some((q) => q.predicate.value.endsWith('maxLength'))).toBe(true)
    const shapes = await toShaclTurtle(ontology)
    expect(shapes).toContain('^[A-Z]')

    const result = await validateData(ontology, ':a a :Pizza ; :name "lowercase name" ; :hasTopping :t .\n:t a :Topping .')
    // The closed Topping shape ignores no properties, so even rdf:type breaks it.
    expect(result.conforms ? [] : result.problems.map((p) => p.component).sort()).toEqual([
      'ClosedConstraintComponent',
      'MaxLengthConstraintComponent',
      'PatternConstraintComponent',
    ])
  })

  it('says what it imported, kept and skipped', async () => {
    const result = await importShapes(
      HEADER +
        `ex:A a sh:NodeShape ; sh:targetClass :Pizza ; sh:property [ sh:path ( :hasTopping :name ) ; sh:minCount 1 ] .
         ex:B a sh:NodeShape ; sh:targetClass :Person .
         ex:C a sh:NodeShape .`,
      base.iri,
      base.nodes,
      base.edges,
    )
    expect(describeShapesImport(result)).toBe(
      "Imported 0 constraints on 1 class. Kept 1 rule the inspector can't edit yet; it exports unchanged. Skipped B (targets Person, not on this page), C (no sh:targetClass).",
    )
  })

  it('reports Turtle errors', async () => {
    await expect(importShapes('ex:A a', base.iri, base.nodes, base.edges)).rejects.toThrow()
  })
})
