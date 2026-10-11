import { describe, expect, it } from 'vitest'
import { mergeNamespaces, namespacePrefixes, renameNamespace, suggestPrefix } from './namespaces'
import { workspaceFrom } from './pages'

const P = 'http://example.org/pizza#'
const RDL = 'http://example.org/rdl/'

describe('namespaces', () => {
  it('declares usable prefixes only, never over the ontology or built-in vocabularies', () => {
    const prefixes = namespacePrefixes(
      [
        { prefix: 'rdl', iri: RDL },
        { prefix: 'owl', iri: 'http://example.org/other#' },
        { prefix: 'dup', iri: P },
        { prefix: '1bad', iri: 'http://example.org/x#' },
        { prefix: 'empty', iri: ' ' },
      ],
      P,
    )
    expect(prefixes).toEqual({ rdl: RDL })
  })

  it('suggests a prefix from the IRI, else a free nsN', () => {
    expect(suggestPrefix(RDL, [])).toBe('rdl')
    expect(suggestPrefix(RDL, ['rdl'])).toBe('ns1')
    expect(suggestPrefix('', ['ns1'])).toBe('ns2')
  })

  it('adds imported namespaces it lacks, renaming a clashing prefix', () => {
    const merged = mergeNamespaces([{ prefix: 'rdl', iri: RDL }], [
      { prefix: 'rdl', iri: RDL },
      { prefix: 'rdl', iri: 'http://example.org/parts#' },
    ])
    expect(merged).toEqual([
      { prefix: 'rdl', iri: RDL },
      { prefix: 'parts', iri: 'http://example.org/parts#' },
    ])
  })

  it('moves classes and properties along when a namespace IRI is edited', () => {
    const { workspace } = workspaceFrom(
      'Page 1',
      [
        { id: 'a', type: 'owlClass', position: { x: 0, y: 0 }, data: { label: 'Cheese', namespace: RDL } },
        { id: 'b', type: 'owlClass', position: { x: 0, y: 0 }, data: { label: 'Pizza' } },
      ],
      [{ id: 'e', type: 'relation', source: 'b', target: 'a', data: { kind: 'objectProperty', label: 'has cheese', namespace: RDL } }],
    )
    const moved = renameNamespace(workspace, RDL, 'http://example.org/rdl2/')
    expect(moved.store.classes.a.namespace).toBe('http://example.org/rdl2/')
    expect(moved.store.classes.b.namespace).toBeUndefined()
    expect(moved.store.relations.e.namespace).toBe('http://example.org/rdl2/')
  })
})
