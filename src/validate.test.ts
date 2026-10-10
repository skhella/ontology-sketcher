import { describe, expect, it } from 'vitest'
import { sampleOntology, type Ontology } from './model'
import { validateData } from './validate'
import { shortName } from './vocab'

const P = 'http://example.org/pizza#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'

const rules: Ontology = {
  ...sampleOntology,
  nodes: sampleOntology.nodes.map((n) =>
    n.id === 'pizza'
      ? {
          ...n,
          data: {
            ...n.data,
            dataProperties: [{ name: 'name', datatype: XSD + 'string' }],
            constraints: [
              { path: { type: 'object', property: 'e3' }, minCount: 1, class: 'topping' },
              { path: { type: 'data', name: 'name' }, maxCount: 1, datatype: XSD + 'string', message: 'Give a pizza one name.' },
            ],
          },
        }
      : n,
  ),
}

describe('validateData', () => {
  it('passes data that follows the rules, checking subclasses through the ontology', async () => {
    expect(await validateData(rules, ':lunch a :Margherita ; :name "Lunch" ; :hasTopping :t1 .\n:t1 a :TomatoTopping .')).toEqual({ conforms: true })
  })

  it('explains each broken rule and names the classes to mark', async () => {
    const result = await validateData(
      rules,
      `:bare a :Margherita ; :name "A", "B" .
       :odd a :Pizza ; :name 42 ; :hasTopping :rock .
       :rock a :Stone .`,
    )
    expect(result.conforms).toBe(false)
    const problems = result.conforms ? [] : result.problems
    const rows = problems.map((p) => [shortName(p.focus), p.classIds.join(), p.path && shortName(p.path), p.message]).sort()
    expect(rows).toEqual([
      ['bare', 'margherita', 'hasTopping', 'needs at least 1 value'],
      ['bare', 'margherita', 'name', 'Give a pizza one name.'],
      ['odd', 'pizza', 'hasTopping', 'rock is not a Topping'],
      ['odd', 'pizza', 'name', 'Give a pizza one name.'],
    ])
  })

  it('reads data with its own prefixes and reports Turtle errors', async () => {
    const own = `@prefix : <http://other.example/> . @prefix p: <${P}> .\n:x a p:Pizza .`
    const result = await validateData(rules, own)
    expect(result.conforms ? [] : result.problems.map((p) => p.message)).toEqual(['needs at least 1 value'])
    await expect(validateData(rules, ':x a :Pizza')).rejects.toThrow()
  })

  it('has nothing to check without constraints', async () => {
    expect(await validateData(sampleOntology, ':x a :Pizza .')).toEqual({ conforms: true })
  })
})

describe('shortName', () => {
  it('uses known prefixes, else the local name', () => {
    expect(shortName(XSD + 'string')).toBe('xsd:string')
    expect(shortName(P + 'Topping')).toBe('Topping')
  })
})
