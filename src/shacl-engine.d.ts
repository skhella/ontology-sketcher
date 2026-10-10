// shacl-engine ships no types; this covers the part the app and tests use.
declare module 'shacl-engine/Validator.js' {
  import type { DatasetCore, Term } from '@rdfjs/types'

  type ValidationResult = {
    focusNode: Term
    path?: { predicates: Term[] }[]
    constraintComponent: Term
    /** The shape's own sh:message, else the engine's default text. */
    message: Term[]
    /** The value that broke the rule, for value constraints such as sh:class. */
    value?: { term: Term }
    /** The constraint's parameters, e.g. { minCount: 1 } or { datatype: <xsd:string> }. */
    args: Record<string, number | Term | undefined>
    /** The shape that was broken; `message` holds only its own sh:message, and `ptr` points at it in the shapes graph. */
    shape: { message: Term[]; ptr: { term: Term } }
  }

  export default class Validator {
    constructor(shapes: DatasetCore, options: { factory: unknown })
    validate(data: { dataset: DatasetCore }): Promise<{ conforms: boolean; results: ValidationResult[] }>
  }
}
