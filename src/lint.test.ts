import { describe, expect, it } from 'vitest'
import { lintOntology } from './lint'
import { sampleOntology } from './model'
import { toTurtle } from './owl'
import { toShaclTurtle } from './shacl'

const P = 'http://example.org/pizza#'
const head = `@prefix : <${P}> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n`
const kinds = (owl: string, shapes: string | null = null) => lintOntology(head + owl, shapes && head + shapes, P).map((f) => f.kind)

describe('lintOntology', () => {
  it('finds nothing to report on the sample, its shapes included', async () => {
    const ontology = {
      ...sampleOntology,
      nodes: sampleOntology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, constraints: [{ path: { type: 'object' as const, property: 'e3' }, minCount: 1, class: 'topping' }] } } : n)),
    }
    expect(lintOntology(await toTurtle(ontology), await toShaclTurtle(ontology), P)).toEqual([])
  })

  it('reports property characteristics that clash, errors first', () => {
    const findings = lintOntology(
      head +
        `:partOf a owl:ObjectProperty, owl:TransitiveProperty, owl:FunctionalProperty ; rdfs:label "part of" ; rdfs:domain :A ; rdfs:range :A .
         :near a owl:ObjectProperty, owl:SymmetricProperty, owl:AsymmetricProperty ; rdfs:label "near" ; rdfs:domain :A ; rdfs:range :A .
         :twin a owl:ObjectProperty ; owl:inverseOf :twin ; rdfs:label "twin" ; rdfs:domain :A ; rdfs:range :A .
         :A a owl:Class ; rdfs:label "A" .`,
      null,
      P,
    )
    expect(findings.map((f) => [f.kind, f.severity, f.title])).toEqual([
      ['symmetric_and_asymmetric', 'error', 'near is both symmetric and asymmetric'],
      ['transitive_and_functional', 'warning', 'part of is both transitive and functional'],
      ['self_inverse', 'info', 'twin is its own inverse'],
    ])
  })

  it('reports subclass and sub-property cycles once each', () => {
    const findings = lintOntology(
      head +
        `:A a owl:Class ; rdfs:label "A" ; rdfs:subClassOf :B . :B a owl:Class ; rdfs:label "B" ; rdfs:subClassOf :C . :C a owl:Class ; rdfs:label "C" ; rdfs:subClassOf :A .
         :D a owl:Class ; rdfs:label "D" ; rdfs:subClassOf :A .
         :p rdfs:subPropertyOf :q . :q rdfs:subPropertyOf :p .`,
      null,
      P,
    )
    expect(findings.map((f) => [f.kind, f.entities.map((e) => e.label)])).toEqual([
      ['subclass_cycle', ['A', 'B', 'C']],
      ['sub_property_cycle', ['p', 'q']],
      ['undeclared_term', ['p', 'q']],
    ])
  })

  it('reports terms the axioms use but never declare, and deprecated terms still in use', () => {
    const findings = lintOntology(
      head +
        `:A a owl:Class ; rdfs:label "A" ; rdfs:subClassOf :Missing, [ a owl:Restriction ; owl:onProperty :hasPart ; owl:someValuesFrom :Old ] ; rdfs:seeAlso :Elsewhere .
         :Old a owl:Class ; rdfs:label "Old" ; owl:deprecated true .
         :Older a owl:Class ; rdfs:label "Older" ; owl:deprecated true ; rdfs:subClassOf :Old .
         :size a owl:DatatypeProperty ; rdfs:label "size" ; rdfs:domain :A ; rdfs:range xsd:integer .`,
      null,
      P,
    )
    expect(findings.map((f) => [f.kind, f.severity, f.title, f.entities.map((e) => e.label)])).toEqual([
      ['undeclared_term', 'warning', '2 terms are used but never declared', ['Missing', 'hasPart']],
      ['deprecated_in_use', 'warning', '1 deprecated term is still in use', ['Old']],
    ])
  })

  it('reports redundant subclasses, several inverses, name case under its own IRI and untagged labels', () => {
    const findings = lintOntology(
      head +
        `:Pizza a owl:Class ; rdfs:label "Pizza"@en ; owl:equivalentClass :Pie ; rdfs:subClassOf :Pie .
         :Pie a owl:Class ; rdfs:label "Pie" .
         :pizza_base a owl:Class ; rdfs:label "base"@en .
         :BFO_0000001 a owl:Class ; rdfs:label "entity"@en .
         <http://other.org/o#reused_name> a owl:Class ; rdfs:label "reused"@en .
         :HasTopping a owl:ObjectProperty ; rdfs:label "has topping"@en ; rdfs:domain :Pizza ; rdfs:range :Pie ; owl:inverseOf :toppingOf, :onPizza .
         :toppingOf a owl:ObjectProperty ; rdfs:label "topping of"@en ; rdfs:domain :Pie ; rdfs:range :Pizza .
         :onPizza a owl:ObjectProperty ; rdfs:label "on pizza"@en ; rdfs:domain :Pie ; rdfs:range :Pizza .`,
      null,
      P,
    )
    expect(findings.map((f) => [f.kind, f.entities.map((e) => e.label)])).toEqual([
      ['redundant_subclass', ['Pizza']],
      ['several_inverses', ['has topping']],
      ['class_name_case', ['base']],
      ['property_name_case', ['has topping']],
      ['label_without_language', ['Pie']],
    ])
  })

  it('reports classes that can have no instances because of disjointness', () => {
    const findings = lintOntology(
      head +
        `:Animal a owl:Class ; rdfs:label "Animal" . :Plant a owl:Class ; rdfs:label "Plant" .
         [] a owl:AllDisjointClasses ; owl:members ( :Animal :Plant ) .
         :Coral a owl:Class ; rdfs:label "Coral" ; rdfs:subClassOf :Animal, :Plant .
         :Dog a owl:Class ; rdfs:label "Dog" ; rdfs:subClassOf :Animal ; owl:disjointWith :Animal .`,
      null,
      P,
    )
    expect(findings.map((f) => f.title)).toEqual([
      'Coral is under both Animal and Plant, which are disjoint',
      'Dog is disjoint with its ancestor Animal',
    ])
  })

  it('groups missing labels, domains and ranges, leaving out outside classes', () => {
    const findings = lintOntology(
      head + `:A a owl:Class . :Ext a owl:Class . :p a owl:ObjectProperty ; rdfs:label "p" ; rdfs:domain :A . :n a owl:DatatypeProperty ; rdfs:label "n" .`,
      null,
      P,
      { outside: new Set([P + 'Ext']) },
    )
    expect(findings.map((f) => [f.kind, f.title, f.entities.map((e) => e.label)])).toEqual([
      ['missing_label', '1 class or property has no label', ['A']],
      ['missing_domain', '1 property has no domain', ['n']],
      ['missing_range', '2 properties have no range', ['n', 'p']],
    ])
  })

  it('reports shapes about undeclared classes and properties, and rules of the wrong kind', () => {
    const owl = `:Pizza a owl:Class ; rdfs:label "Pizza" . :hasTopping a owl:ObjectProperty ; rdfs:label "has topping" ; rdfs:domain :Pizza ; rdfs:range :Pizza .
      :name a owl:DatatypeProperty ; rdfs:label "name" ; rdfs:domain :Pizza ; rdfs:range xsd:string .`
    const shapes = `:PizzaShape a sh:NodeShape ; sh:targetClass :Piza ;
        sh:property [ sh:path :hasTopping ; sh:datatype xsd:string ] , [ sh:path :name ; sh:class :Pizza ] , [ sh:path :colour ; sh:minCount 1 ] ,
          [ sh:path [ sh:inversePath :hasTopping ] ; sh:class :Base ] , [ sh:path rdfs:label ; sh:minCount 1 ] .`
    const findings = lintOntology(head + owl, head + shapes, P)
    expect(findings.map((f) => f.title)).toEqual([
      'PizzaShape asks for a datatype on has topping, an object property',
      'PizzaShape asks for a class on name, a data property',
      'PizzaShape refers to Piza, which the ontology does not declare',
      'PizzaShape refers to Base, which the ontology does not declare',
      'PizzaShape constrains colour, which the ontology does not declare',
    ])
    expect(kinds(owl)).toEqual([])
  })
})
