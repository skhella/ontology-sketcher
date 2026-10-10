import { DataFactory, Parser, Store, type Quad } from 'n3'
import Validator from 'shacl-engine/Validator.js'
import { localName, type Ontology } from './model'
import { entityIri, toTurtle } from './owl'
import { SH, toShaclTurtle } from './shacl'
import { RDF, shortName } from './vocab'

/** One problem in the sample data, ready to show: what broke which rule, and the classes it belongs to. */
export type Problem = {
  /** The thing that breaks the rule, e.g. http://example.org/pizza#bare. */
  focus: string
  /** Ids of the canvas classes the thing is typed with (rdf:type), to mark them on the canvas. */
  classIds: string[]
  /** The property the rule is about, when it is a property rule. */
  path?: string
  /** The SHACL constraint component without its namespace, e.g. MinCountConstraintComponent. */
  component: string
  message: string
}

export type ValidationResult = { conforms: true } | { conforms: false; problems: Problem[] }

/**
 * Checks sample data (Turtle) against the shapes the classes' constraints export to.
 * The ontology goes into both graphs, so a Margherita is checked as a Pizza and a TomatoTopping counts as a Topping:
 * the SHACL spec reads rdfs:subClassOf from the data graph (sh:class does here too), while shacl-engine
 * resolves sh:targetClass subclasses from the shapes graph.
 * Throws the parser's error when the Turtle does not parse.
 */
export async function validateData(ontology: Ontology, dataTurtle: string): Promise<ValidationResult> {
  // Relative IRIs and the empty prefix resolve against the ontology, so `:bare a :Pizza` works without a header.
  const parse = (turtle: string) => new Parser({ baseIRI: ontology.iri }).parse(turtle)
  const header = /^\s*@prefix\s+:/m.test(dataTurtle) ? '' : `@prefix : <${ontology.iri}> . `
  const sample = parse(header + dataTurtle)

  const owl = parse(await toTurtle(ontology))
  const shapes = new Store([...parse(await toShaclTurtle(ontology)), ...owl])
  const data = new Store([...owl, ...sample])
  const factory = { ...DataFactory, dataset: (quads?: Iterable<Quad>) => new Store(quads ? [...quads] : undefined) }
  const report = await new Validator(shapes, { factory }).validate({ dataset: data })
  if (report.conforms) return { conforms: true }

  const classOf = new Map(ontology.nodes.map((n) => [entityIri(ontology.iri, n.data, localName(n.data.label)), n.id]))
  const problems = report.results.map((r): Problem => {
    const focus = r.focusNode.value
    const types = sample.filter((q) => q.subject.value === focus && q.predicate.value === RDF + 'type').map((q) => q.object.value)
    const component = r.constraintComponent.value.replace(SH, '')
    // The constraint's own message when it has one, else a sentence about what was wrong.
    const own = r.shape.message.map((m) => m.value).find((m) => m.trim())
    const value = r.value?.term
    const valueText = value ? (value.termType === 'Literal' ? `"${value.value}"` : shortName(value.value)) : 'a value'
    const count = (n: unknown) => `${n} value${n === 1 ? '' : 's'}`
    const required = shapes.getObjects(r.shape.ptr.term, SH + 'class', null)[0]?.value
    const datatype = r.args.datatype as { value: string } | undefined
    const explained: Record<string, string | undefined> = {
      MinCountConstraintComponent: `needs at least ${count(r.args.minCount)}`,
      MaxCountConstraintComponent: `allows at most ${count(r.args.maxCount)}`,
      ClassConstraintComponent: required && `${valueText} is not a ${shortName(required)}`,
      DatatypeConstraintComponent: datatype && `${valueText} is not ${shortName(datatype.value)}`,
    }
    return {
      focus,
      classIds: [...new Set(types.map((t) => classOf.get(t)).filter((id): id is string => !!id))],
      path: r.path?.[0]?.predicates[0]?.value,
      component,
      message: own ?? explained[component] ?? (r.message.map((m) => m.value).join(' ') || component),
    }
  })
  return { conforms: false, problems }
}
