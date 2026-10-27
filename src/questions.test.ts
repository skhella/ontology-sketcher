import { describe, expect, it } from 'vitest'
import { sampleOntology } from './model'
import { toTurtle } from './owl'
import { newQuestion, readQuestions, runQuestions } from './questions'

const P = 'http://example.org/pizza#'

describe('runQuestions', () => {
  it('passes questions the ontology answers and fails the rest, naming answers by label', async () => {
    const turtle = await toTurtle(sampleOntology)
    const questions = [
      { ...newQuestion('Pizza'), id: 'kinds' },
      { id: 'ask', question: 'Do toppings exist?', sparql: 'ASK { :Topping a owl:Class }' },
      { id: 'cheese', question: 'Is there cheese?', sparql: 'ASK { ?c rdfs:label "Cheese" }' },
      { id: 'labels', question: 'Does every class have a label?', sparql: 'SELECT ?c WHERE { ?c a owl:Class FILTER NOT EXISTS { ?c rdfs:label ?l } }', expect: 'none' as const },
      { id: 'bad', question: 'Broken', sparql: 'SELEC ?x' },
    ]
    const results = await runQuestions(questions, turtle, P, [])
    expect(results.get('kinds')).toEqual({ ok: true, kind: 'select', variables: ['kind'], rows: [['Margherita']], total: 1 })
    expect(results.get('ask')).toEqual({ ok: true, kind: 'ask', answer: true })
    expect(results.get('cheese')).toEqual({ ok: false, kind: 'ask', answer: false })
    expect(results.get('labels')).toMatchObject({ ok: true, total: 0 })
    expect(results.get('bad')).toMatchObject({ ok: false, kind: 'error' })
  })
})

describe('readQuestions', () => {
  it('keeps well-formed questions from a project file', () => {
    expect(readQuestions([{ id: 'a', question: 'Q', sparql: 'ASK {}', expect: 'none' }, { id: 1 }, null])).toEqual([{ id: 'a', question: 'Q', sparql: 'ASK {}', expect: 'none' }])
    expect(readQuestions(undefined)).toEqual([])
  })
})
