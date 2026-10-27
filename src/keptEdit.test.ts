import { describe, expect, it } from 'vitest'
import { editKeptTriple, editNaming, type KeptTriple } from './keptEdit'

const EX = 'http://example.org/zoo#'
const CLOSE = 'http://www.w3.org/2004/02/skos/core#closeMatch'
const NOTE = 'http://www.w3.org/2004/02/skos/core#note'
const dogMatch: KeptTriple = { subject: EX + 'Dog', predicate: CLOSE, object: { kind: 'iri', value: 'http://example.org/other#Hound' } }
const statements = [
  { ntriples: `<${EX}Dog> <${CLOSE}> <http://example.org/other#Hound> .\n`, about: EX + 'Dog' },
  { ntriples: `<${EX}tom> <${EX}age> "3"^^<http://www.w3.org/2001/XMLSchema#integer> .\n` },
]

describe('editKeptTriple', () => {
  it('changes a value in the statement it was in, keeping what that statement is about', () => {
    const next = editKeptTriple(statements, dogMatch, { ...dogMatch, object: { kind: 'iri', value: 'http://example.org/other#Wolf' } })
    expect(next).toEqual([{ ntriples: `<${EX}Dog> <${CLOSE}> <http://example.org/other#Wolf> .\n`, about: EX + 'Dog' }, statements[1]])
  })

  it('finds a typed literal to change and keeps its datatype', () => {
    const age: KeptTriple = { subject: EX + 'tom', predicate: EX + 'age', object: { kind: 'literal', value: '3', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } }
    const next = editKeptTriple(statements, age, { ...age, object: { ...age.object, value: '4' } })
    expect(next[1].ntriples).toBe(`<${EX}tom> <${EX}age> "4"^^<http://www.w3.org/2001/XMLSchema#integer> .\n`)
  })

  it('drops a statement left empty by a removal', () => {
    expect(editKeptTriple(statements, dogMatch, undefined)).toEqual([statements[1]])
  })

  it('adds to the statements about the same subject, else a new one about the given thing', () => {
    const note = (subject: string): KeptTriple => ({ subject, predicate: NOTE, object: { kind: 'literal', value: 'friendly', lang: 'en' } })
    expect(editKeptTriple(statements, undefined, note(EX + 'Dog'))[0].ntriples).toContain(`<${EX}Dog> <${NOTE}> "friendly"@en .`)
    expect(editKeptTriple(statements, undefined, note(EX + 'Cat')).at(-1)).toEqual({ ntriples: `<${EX}Cat> <${NOTE}> "friendly"@en .\n` })
    expect(editKeptTriple(statements, undefined, note(EX + 'Cat'), EX + 'Cat').at(-1)).toEqual({ ntriples: `<${EX}Cat> <${NOTE}> "friendly"@en .\n`, about: EX + 'Cat' })
  })

  it('leaves the statements alone when the old triple is not there and nothing is added', () => {
    expect(editKeptTriple(statements, { ...dogMatch, subject: EX + 'Cat' }, undefined)).toEqual(statements)
  })
})

describe('editNaming', () => {
  const names = new Map([[EX + 'Dog', 'Dog']])
  const naming = editNaming({
    name: (iri) => names.get(iri) ?? iri.replace(/^.*#/, ''),
    resolve: (text) => (text === 'Dog' ? EX + 'Dog' : text === 'skos:note' ? NOTE : text.includes(':') ? text : EX + text),
  })

  it('names by label when the label reads back, else as <IRI>', () => {
    expect(naming.name(EX + 'Dog')).toBe('Dog')
    expect(naming.name('http://example.org/other#Hound')).toBe('<http://example.org/other#Hound>')
  })

  it('reads labels, prefixed names, <IRI> and web IRIs, and refuses an unknown prefix', () => {
    expect(['Dog', 'skos:note', '<http://example.org/other#Hound>', 'https://example.org/x'].map(naming.resolve)).toEqual([
      EX + 'Dog',
      NOTE,
      'http://example.org/other#Hound',
      'https://example.org/x',
    ])
    expect(naming.resolve('nope:x')).toBeUndefined()
  })
})
