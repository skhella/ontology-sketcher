import { describe, expect, it } from 'vitest'
import { ANNOTATION_DESCRIPTIONS, ANNOTATION_PROPERTIES, compactIri, expandIri, SKOS, SKOS_ANNOTATION_PROPERTIES } from './vocab'

describe('IRI helpers', () => {
  const base = 'http://example.org/pizza#'

  it('expands prefixed names, full IRIs and bare local names', () => {
    expect(expandIri('skos:note', base)).toBe(SKOS + 'note')
    expect(expandIri('https://schema.org/name', base)).toBe('https://schema.org/name')
    expect(expandIri(' myNote ', base)).toBe(base + 'myNote')
  })

  it('compacts IRIs with a known prefix only', () => {
    expect(compactIri(SKOS + 'definition')).toBe('skos:definition')
    expect(compactIri(base + 'Pizza')).toBe(base + 'Pizza')
  })
})

describe('ANNOTATION_DESCRIPTIONS', () => {
  it('describes every annotation property the inspector offers', () => {
    for (const p of [...ANNOTATION_PROPERTIES, ...SKOS_ANNOTATION_PROPERTIES]) expect(ANNOTATION_DESCRIPTIONS[p], p).toBeTruthy()
  })
})
