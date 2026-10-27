import { useState } from 'react'
import type { ClassNode, Ontology } from './model'
import type { ValidationResult } from './validate'
import { shortName } from './vocab'
import { FloatingPanel } from './FloatingPanel'

type Props = {
  /** The whole ontology, all pages, at the moment of checking. */
  ontology: () => Ontology
  nodes: ClassNode[]
  /** Called with the ids of the classes whose instances break a rule, empty when none do or the panel closes. */
  onProblemClasses: (ids: string[]) => void
  onSelectClass: (id: string) => void
  onClose: () => void
}

const PLACEHOLDER = `:lunch a :Margherita ;
    :hasTopping :t1 .
:t1 a :TomatoTopping .`

/**
 * A panel to paste example instances in Turtle and check them against the classes' SHACL constraints.
 * The validator loads on first use so it stays out of the editor's start-up bundle.
 */
export function SampleData({ ontology, nodes, onProblemClasses, onSelectClass, onClose }: Props) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ValidationResult | { error: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? id

  const check = async () => {
    setChecking(true)
    try {
      const { validateData } = await import('./validate')
      const next = await validateData(ontology(), text)
      setResult(next)
      onProblemClasses(next.conforms ? [] : [...new Set(next.problems.flatMap((p) => p.classIds))])
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) })
      onProblemClasses([])
    } finally {
      setChecking(false)
    }
  }
  const close = () => {
    onProblemClasses([])
    onClose()
  }
  // Constraints on classes of this page; other pages may hold more, so this only drives a hint.
  const hasRules = nodes.some((n) => !!n.data.constraints?.length)

  return (
    <FloatingPanel name="sample-data" className="sample-data" aria-label="Sample data">
      <div className="export-actions">
        <strong>Sample data</strong>
        <button onClick={check} disabled={checking || !text.trim()}>
          {checking ? 'Checking…' : 'Check'}
        </button>
        <button onClick={close}>Close</button>
      </div>
      <p className="hint">
        Paste example instances in Turtle to check them against the classes' constraints. <code>:</code> is the ontology IRI unless you declare it.
      </p>
      {!hasRules && <p className="hint">No class on this page has constraints yet. Add some under Constraints (SHACL) in a class.</p>}
      <textarea value={text} placeholder={PLACEHOLDER} spellCheck={false} aria-label="Sample data in Turtle" onChange={(e) => setText(e.target.value)} />
      {result && 'error' in result && <p className="sample-error">This isn't valid Turtle: {result.error}</p>}
      {result && 'conforms' in result && result.conforms && <p className="sample-ok">✓ The data follows every constraint.</p>}
      {result && 'conforms' in result && !result.conforms && (
        <ul className="sample-problems">
          {result.problems.map((p, i) => (
            <li key={i}>
              <button onClick={() => p.classIds[0] && onSelectClass(p.classIds[0])} disabled={p.classIds.length === 0} title="Select the class">
                <strong>{shortName(p.focus)}</strong>
                {p.classIds.length > 0 && <span className="muted"> ({p.classIds.map(labelOf).join(', ')})</span>}
                {p.path && <> · {shortName(p.path)}</>}: {p.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </FloatingPanel>
  )
}
