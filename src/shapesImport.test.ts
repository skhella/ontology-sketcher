import { describe, expect, it } from 'vitest'
import { sampleOntology, type ClassNode, type Ontology } from './model'
import { toShaclTurtle } from './shacl'
import { loadCanvas, workspaceFrom } from './pages'
import { applyShapes, describeShapesImport, importShapes, importShapesToWorkspace, keptShapesTargeting } from './shapesImport'
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
    return shapes ? { ...n, data: { ...n.data, constraints: shapes.constraints, constraintsClosed: shapes.closed, extraShapes: shapes.extra } } : n
  })
  return { ...base, nodes }
}

const HEADER = `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <${XSD}> . @prefix : <${P}> . @prefix ex: <http://shapes.example/> .\n`

describe('importShapes', () => {
  it('reads an exported shapes file back into the same constraints', async () => {
    const constraints = [
      { path: { type: 'object' as const, property: 'e3' }, minCount: 1, class: 'topping', message: 'A pizza needs a topping.' },
      { path: { type: 'data' as const, name: 'name' }, maxCount: 1, datatype: XSD + 'string', pattern: '^[A-Z]', allowed: ['Lunch', 'Dinner'], minLength: 2, maxLength: 20 },
      { path: { type: 'data' as const, name: 'price' }, minValue: '4.5', maxValue: '30' },
    ]
    const ontology = { ...base, nodes: base.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, constraints, constraintsClosed: true } } : n)) }
    ontology.nodes = ontology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, dataProperties: [...n.data.dataProperties!, { name: 'price', datatype: XSD + 'decimal' }] } } : n))
    const result = await importShapes(await toShaclTurtle(ontology), base.iri, ontology.nodes, base.edges)

    expect([...result.classes.keys()]).toEqual(['pizza'])
    expect(result.classes.get('pizza')).toEqual({ constraints, closed: true })
    expect(describeShapesImport(result)).toBe('Imported 3 constraints on 1 class.')
  })

  it('keeps what rows cannot hold as Turtle, exports it unchanged and still checks it', async () => {
    const ontology = await imported(
      HEADER +
        `ex:PizzaShape a sh:NodeShape ; sh:targetClass :Pizza ;
           sh:property [ sh:path :hasTopping ; sh:minCount 1 ] ;
           sh:property [ sh:path :name ; sh:pattern "^[0-9]" ; sh:flags "i" ] ;
           sh:property ex:NameLength .
         ex:NameLength sh:path :name ; sh:maxLength 8 ; sh:severity sh:Warning .
         ex:ToppingShape a sh:NodeShape ; sh:targetClass :Topping ; sh:closed true .
         ex:PersonShape a sh:NodeShape ; sh:targetClass :Person ; sh:property [ sh:path :name ; sh:minCount 1 ] .`,
    )
    const pizza = ontology.nodes.find((n) => n.id === 'pizza')!.data
    expect(pizza.constraints).toEqual([{ path: { type: 'object', property: 'e3' }, minCount: 1 }])
    expect(pizza.extraShapes).toContain('^[0-9]')
    expect(ontology.nodes.find((n) => n.id === 'topping')!.data).toMatchObject({ constraints: [], extraShapes: expect.stringContaining('closed') })

    // The kept parts parse on their own, the named property shape comes with them, and they reach shapes.ttl.
    expect(parseTurtle(pizza.extraShapes!, base.iri).store.getQuads(null, null, null, null).some((q) => q.predicate.value.endsWith('maxLength'))).toBe(true)
    const shapes = await toShaclTurtle(ontology)
    expect(shapes).toContain('^[0-9]')

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
        // A property path, and integers that would come back from the inspector as decimals.
        `ex:A a sh:NodeShape ; sh:targetClass :Pizza ; sh:property [ sh:path ( :hasTopping :name ) ; sh:minCount 1 ] , [ sh:path :name ; sh:in ( 1 2 ) ] .
         ex:B a sh:NodeShape ; sh:targetClass :Person .
         ex:C a sh:NodeShape .`,
      base.iri,
      base.nodes,
      base.edges,
    )
    expect(describeShapesImport(result)).toBe(
      "Imported 0 constraints on 1 class. Kept 2 rules the inspector can't edit yet; they export unchanged. Skipped B (targets Person, not in the ontology), C (no sh:targetClass).",
    )
  })

  it('reads shapes onto classes on every page, not just the open one', async () => {
    // Pizza on the first page, Topping placed only on a second page.
    const first = workspaceFrom('Main', base.nodes.filter((n) => n.id !== 'topping'), [])
    const topping = base.nodes.find((n) => n.id === 'topping')!
    const ws = {
      store: { ...first.workspace.store, classes: { ...first.workspace.store.classes, topping: topping.data } },
      pages: [...first.workspace.pages, { id: 'second', name: 'Detail', nodes: [{ ...topping, data: {} }], edges: [] }],
    }
    const result = await importShapesToWorkspace(
      HEADER +
        `ex:A a sh:NodeShape ; sh:targetClass :Pizza ; sh:property [ sh:path :name ; sh:maxCount 1 ] .
         ex:B a sh:NodeShape ; sh:targetClass :Topping ; sh:closed true .
         ex:C a sh:NodeShape ; sh:targetClass :Person .`,
      base.iri,
      ws,
    )
    expect([...result.classes.keys()].sort()).toEqual(['pizza', 'topping'])
    expect(describeShapesImport(result)).toBe(
      "Imported 1 constraint on 2 classes. Kept 1 rule the inspector can't edit yet; it exports unchanged. Skipped C (targets Person, not in the ontology).",
    )
    const next = applyShapes(ws, result)
    expect(loadCanvas(next, first.pageId).nodes.find((n) => n.id === 'pizza')!.data.constraints).toEqual([{ path: { type: 'data', name: 'name' }, maxCount: 1 }])
    expect(loadCanvas(next, 'second').nodes[0].data.extraShapes).toContain('closed')
  })

  it('lists a kept shape on every class it targets, not just the one keeping it', async () => {
    const result = await importShapes(
      HEADER + `ex:Both a sh:NodeShape ; sh:targetClass :Pizza , :Topping ; sh:severity sh:Warning ; sh:property [ sh:path :name ; sh:minCount 1 ] .`,
      base.iri,
      base.nodes,
      base.edges,
    )
    expect(result.kept).toBe(1)
    const keeper = [...result.classes.keys()][0]
    const other = keeper === 'pizza' ? 'topping' : 'pizza'
    const classes = Object.fromEntries(
      base.nodes.map((n) => [n.id, result.classes.has(n.id) ? { ...n.data, extraShapes: result.classes.get(n.id)!.extra } : n.data]),
    )
    const keeperLabel = base.nodes.find((n) => n.id === keeper)!.data.label
    expect(keptShapesTargeting(base.iri, classes, other)).toEqual([{ label: keeperLabel, shapes: ['Both'] }])
    expect(keptShapesTargeting(base.iri, classes, keeper)).toEqual([])
  })

  it('reports Turtle errors', async () => {
    await expect(importShapes('ex:A a', base.iri, base.nodes, base.edges)).rejects.toThrow()
  })
})
