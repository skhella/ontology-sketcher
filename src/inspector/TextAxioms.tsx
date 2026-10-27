import { useState } from 'react'
import type { TextAxiom } from '../textAxioms'

/** The text axioms of one kind on a class and the editing they allow; `apply` throws with a message on text it can't read. */
export type TextAxiomEditing = {
  axioms: TextAxiom[]
  apply: (text: string, replacing?: TextAxiom) => void
  remove: (axiom: TextAxiom) => void
}

/**
 * Axioms the rows above can't hold (unions, intersections, complements, nested restrictions), edited as Manchester
 * syntax text as in Protégé, e.g. `uses only (GuideWord or Criteria)`. A change applies on Enter or when leaving the box.
 */
export function TextAxioms({ editing, title }: { editing: TextAxiomEditing; title: string }) {
  const [adding, setAdding] = useState<string | null>(null)
  return (
    <>
      {editing.axioms.map((a) => (
        <TextAxiomRow key={`${a.statement}-${a.n}-${a.text}`} text={a.text} title={title} onApply={(text) => editing.apply(text, a)} onRemove={() => editing.remove(a)} />
      ))}
      {adding !== null ? (
        <TextAxiomRow
          text=""
          title={title}
          autoFocus
          onApply={(text) => {
            editing.apply(text)
            setAdding(null)
          }}
          onRemove={() => setAdding(null)}
        />
      ) : (
        <button className="add" onClick={() => setAdding('')} title="Write a class expression, e.g. hasPart some (Pump or Valve)">
          + as text
        </button>
      )}
    </>
  )
}

function TextAxiomRow({ text, title, autoFocus, onApply, onRemove }: { text: string; title: string; autoFocus?: boolean; onApply: (text: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  const apply = () => {
    if (draft.trim() === text || !draft.trim()) return
    try {
      onApply(draft.trim())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="axiom-row text-axiom">
      <input
        value={draft}
        autoFocus={autoFocus}
        placeholder="e.g. hasPart some (Pump or Valve)"
        aria-label={`${title} axiom as text`}
        aria-invalid={!!error}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
          if (e.key === 'Escape') {
            setDraft(text)
            setError(null)
          }
        }}
      />
      <button className="remove" aria-label={`Remove ${title} axiom`} onClick={onRemove}>
        ×
      </button>
      {error && <small className="sample-error text-axiom-error">{error}</small>}
    </div>
  )
}
