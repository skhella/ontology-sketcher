// shacl-engine ships no types; this covers the part the app and tests use.
declare module 'shacl-engine/Validator.js' {
  import type { DatasetCore, Term } from '@rdfjs/types'

  type ValidationResult = {
    focusNode: Term
    path?: { predicates: Term[] }[]
    constraintComponent: Term
    message: Term[]
  }

  export default class Validator {
    constructor(shapes: DatasetCore, options: { factory: unknown })
    validate(data: { dataset: DatasetCore }): Promise<{ conforms: boolean; results: ValidationResult[] }>
  }
}
