import type { Inference } from '../reason'

type Props = {
  /** Undefined while the reasoner runs. */
  inferences: Inference[] | undefined
  labelOf: (iri: string) => string
}

/** Superclasses that follow from the ontology without being stated, each with the axioms it rests on (see reason.ts). */
export function InferredSuperclasses({ inferences, labelOf }: Props) {
  return (
    <fieldset className="axioms inferred">
      <legend>Inferred superclasses</legend>
      {!inferences ? (
        <p className="muted">Working it out…</p>
      ) : inferences.length === 0 ? (
        <p className="muted">None beyond what is stated.</p>
      ) : (
        inferences.map((i) => (
          <details className="axiom-row" key={i.sup}>
            <summary title={i.sup}>{labelOf(i.sup)}</summary>
            <p className="muted">Because:</p>
            <ul>
              {i.because.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </details>
        ))
      )}
    </fieldset>
  )
}
