import { describe, expect, it } from 'vitest'
import { diffOntologies } from './diff'
import { canvasDiff, GHOST } from './diffCanvas'
import { saveLayout } from './layout'
import { sampleOntology, type Ontology } from './model'
import { toTurtle } from './owl'
import { workspaceFrom } from './pages'

const P = 'http://example.org/pizza#'

/** The sample's export with its layout, as Ontology Sketcher writes it. */
async function exported(ontology: Ontology) {
  const { workspace, pageId } = workspaceFrom('Page 1', ontology.nodes, ontology.edges)
  return { text: await toTurtle(ontology, saveLayout(workspace, [pageId], P)), workspace, pageId }
}

// Margherita removed, Pizza given a comment, Cheese added under Topping, has topping made functional.
const edited: Ontology = {
  ...sampleOntology,
  nodes: [
    ...sampleOntology.nodes
      .filter((n) => n.id !== 'margherita')
      .map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, annotations: [{ property: 'http://www.w3.org/2000/01/rdf-schema#comment', value: 'A dish' }] } } : n)),
    { id: 'cheese', type: 'owlClass', position: { x: 700, y: 260 }, data: { label: 'Cheese' } },
  ],
  edges: [
    ...sampleOntology.edges
      .filter((e) => e.id !== 'e1')
      .map((e) => (e.id === 'e3' ? { ...e, data: { ...e.data!, characteristics: ['functional' as const] } } : e)),
    { id: 'e4', type: 'relation', source: 'cheese', target: 'topping', data: { kind: 'subClassOf', label: '' } },
  ],
}

describe('diffOntologies', () => {
  it('finds nothing between two exports of the same ontology, even after moving a class', async () => {
    const before = await exported(sampleOntology)
    const moved = await exported({ ...sampleOntology, nodes: sampleOntology.nodes.map((n) => ({ ...n, position: { x: n.position.x + 50, y: 0 } })) })
    expect(diffOntologies(before.text, moved.text, P)).toMatchObject({ entities: [], arrows: [] })
  })

  it('lists added, changed and removed classes and properties, and the arrows that came and went', async () => {
    const diff = diffOntologies((await exported(sampleOntology)).text, (await exported(edited)).text, P)
    expect(diff.entities.map((e) => [e.status, e.label, e.changes.map((c) => `${c.sign} ${c.text}`)])).toEqual([
      ['added', 'Cheese', ['+ a owl:Class', '+ label "Cheese"', '+ subClassOf Topping']],
      ['changed', 'has topping', ['+ a owl:FunctionalProperty']],
      ['changed', 'Pizza', ['+ comment "A dish"']],
      ['removed', 'Margherita', ['- a owl:Class', '- label "Margherita"', '- subClassOf Pizza']],
    ])
    expect(diff.arrows.map((a) => [a.status, a.source.replace(P, ''), a.kind, a.target.replace(P, '')])).toEqual([
      ['added', 'Cheese', 'subClassOf', 'Topping'],
      ['removed', 'Margherita', 'subClassOf', 'Pizza'],
    ])
  })

  it('reads arrows from the triples when a file has no layout, and restrictions in words', async () => {
    const plain = `@prefix : <${P}> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Pizza a owl:Class ; rdfs:label "Pizza" . :Topping a owl:Class ; rdfs:label "Topping" .
      :hasTopping a owl:ObjectProperty ; rdfs:label "has topping" ; rdfs:domain :Pizza ; rdfs:range :Topping .`
    const more = plain + `\n:Pizza rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:minQualifiedCardinality 1 ; owl:onClass :Topping ] .`
    const diff = diffOntologies(plain, more, P)
    expect(diff.entities.map((e) => [e.status, e.label, e.changes.map((c) => c.text)])).toEqual([['changed', 'Pizza', ['subClassOf has topping min 1 Topping']]])
    expect(diff.arrows).toEqual([])
  })
})

describe('canvasDiff', () => {
  it('colours what changed on the page and draws removed classes and arrows where they were', async () => {
    const before = await exported(sampleOntology)
    const after = await exported(edited)
    const diff = diffOntologies(before.text, after.text, P)
    const page = { nodes: edited.nodes, edges: edited.edges }
    const shown = canvasDiff(diff, after.workspace, after.pageId, P, page)
    expect(Object.fromEntries(shown.nodes)).toEqual({ pizza: 'changed', cheese: 'added' })
    expect(Object.fromEntries(shown.edges)).toEqual({ e3: 'changed', e4: 'added' })
    expect(shown.ghostNodes.map((n) => [n.id, n.data.label, n.position])).toEqual([[GHOST + P + 'Margherita', 'Margherita', { x: 80, y: 260 }]])
    expect(shown.ghostEdges.map((e) => [e.source, e.target, e.data?.kind])).toEqual([[GHOST + P + 'Margherita', 'pizza', 'subClassOf']])
  })

  it('reads the file as the newer version: its extra classes are added ghosts, and the canvas extras are removed', async () => {
    const older = await exported(sampleOntology)
    const newer = await exported(edited)
    const diff = diffOntologies(newer.text, older.text, P)
    const shown = canvasDiff(diff, newer.workspace, newer.pageId, P, { nodes: edited.nodes, edges: edited.edges }, true)
    expect(Object.fromEntries(shown.nodes)).toEqual({ pizza: 'changed', cheese: 'removed' })
    expect(Object.fromEntries(shown.edges)).toEqual({ e3: 'changed', e4: 'removed' })
    expect(shown.ghostNodes.map((n) => [n.id, n.className])).toEqual([[GHOST + P + 'Margherita', 'diff-ghost diff-added']])
    expect(shown.ghostEdges.map((e) => [e.source, e.target, e.className])).toEqual([[GHOST + P + 'Margherita', 'pizza', 'diff-ghost diff-added']])
  })

  it('keeps what changed on each coloured class and ghost, for its badge', async () => {
    const before = await exported(sampleOntology)
    const after = await exported(edited)
    const diff = diffOntologies(before.text, after.text, P)
    const shown = canvasDiff(diff, after.workspace, after.pageId, P, { nodes: edited.nodes, edges: edited.edges })
    expect([...shown.changes.keys()].sort()).toEqual(['cheese', GHOST + P + 'Margherita', 'pizza'].sort())
    expect(shown.changes.get('pizza')).toBe(diff.entities.find((e) => e.label === 'Pizza'))
    expect(shown.changes.get(GHOST + P + 'Margherita')?.status).toBe('removed')
  })
})
