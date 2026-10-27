import type { CompetencyQuestion, QuestionResult } from './questions'

type Props = {
  questions: CompetencyQuestion[]
  /** By question id; missing until the questions are run, and dropped for a question once it is edited. */
  results: Map<string, QuestionResult>
  running: boolean
  error?: string
  onChange: (questions: CompetencyQuestion[]) => void
  onAdd: () => void
  onRun: () => void
  onClose: () => void
}

/** Competency questions with their SPARQL, run against the export of every page; see questions.ts. */
export function QuestionsPanel({ questions, results, running, error, onChange, onAdd, onRun, onClose }: Props) {
  const update = (id: string, patch: Partial<CompetencyQuestion>) => onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  const passed = questions.filter((q) => results.get(q.id)?.ok).length
  const ran = questions.filter((q) => results.has(q.id)).length
  return (
    <aside className="property-hierarchy questions-panel" aria-label="Competency questions">
      <div className="export-actions">
        <strong>Competency questions</strong>
        <button onClick={onRun} disabled={running || questions.length === 0}>
          {running ? 'Running…' : 'Run all'}
        </button>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="hint">
        What the ontology should answer, each as a SPARQL query over the export. <code>:</code> is your ontology, and rdfs, owl, skos and your
        namespaces are declared. A question passes when it has an answer.
        {ran > 0 && (
          <>
            {' '}
            <strong>
              {passed} of {ran} pass.
            </strong>
          </>
        )}
      </p>
      {error && <p className="hint sample-error">{error}</p>}
      <ol className="questions">
        {questions.map((q) => {
          const result = results.get(q.id)
          return (
            <li key={q.id} className={result ? (result.ok ? 'pass' : 'fail') : undefined}>
              <div className="question-head">
                <span className="question-mark" aria-label={result ? (result.ok ? 'Passes' : 'Fails') : 'Not run'}>
                  {result ? (result.ok ? '✓' : '✗') : '·'}
                </span>
                <input value={q.question} placeholder="Question in words" aria-label="Question" onChange={(e) => update(q.id, { question: e.target.value })} />
                <button className="remove" aria-label="Remove question" onClick={() => onChange(questions.filter((x) => x.id !== q.id))}>
                  ×
                </button>
              </div>
              <textarea value={q.sparql} rows={3} spellCheck={false} aria-label="SPARQL query" onChange={(e) => update(q.id, { sparql: e.target.value })} />
              <label className="hint">
                <input type="checkbox" checked={q.expect === 'none'} onChange={(e) => update(q.id, { expect: e.target.checked ? 'none' : undefined })} /> Passes when there is no
                answer
              </label>
              {result && <Answer result={result} />}
            </li>
          )
        })}
      </ol>
      <div className="export-actions">
        <button onClick={onAdd}>+ Question</button>
      </div>
    </aside>
  )
}

function Answer({ result }: { result: QuestionResult }) {
  if (result.kind === 'error') return <p className="hint sample-error">{result.message}</p>
  if (result.kind === 'ask') return <p className="hint">Answer: {result.answer ? 'yes' : 'no'}</p>
  if (result.total === 0) return <p className="hint">No answers.</p>
  return (
    <div className="question-answer">
      <table>
        <thead>
          <tr>
            {result.variables.map((v) => (
              <th key={v}>?{v}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.total > result.rows.length && <p className="hint">and {result.total - result.rows.length} more</p>}
    </div>
  )
}
