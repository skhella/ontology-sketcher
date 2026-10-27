import type { OntologyDiff, Status } from './diff'
import type { CanvasTarget } from './canvasTargets'
import { DIFF_COLORS } from './diffCanvas'


type Props = {
  /** The file compared with, if one is chosen. */
  baseline: { name: string } | null
  /** The file imported this session, offered as a baseline. */
  imported: { name: string } | null
  diff: OntologyDiff | undefined
  error?: string
  targets: Map<string, CanvasTarget>
  onChooseFile: () => void
  onUseImported: () => void
  onShow: (target: CanvasTarget) => void
  onClose: () => void
}

const HEADINGS: Record<Status, string> = { added: 'Added', changed: 'Changed', removed: 'Removed' }

/** What changed since an earlier file, see diff.ts; the canvas colours the same changes while this is open. */
export function DiffPanel({ baseline, imported, diff, error, targets, onChooseFile, onUseImported, onShow, onClose }: Props) {
  const entities = diff?.entities ?? []
  const count = (s: Status) => entities.filter((e) => e.status === s).length
  return (
    <aside className="property-hierarchy diff-panel" aria-label="Compare with a file">
      <div className="export-actions">
        <strong>Compare</strong>
        <button onClick={onChooseFile}>{baseline ? 'Other file…' : 'Choose file…'}</button>
        <button onClick={onClose}>Close</button>
      </div>
      {!baseline ? (
        <>
          <p className="hint">Compare the canvas with an earlier Turtle file, such as a previous export. Changes are coloured on the canvas.</p>
          {imported && (
            <p className="hint">
              <button onClick={onUseImported}>Compare with {imported.name} (imported)</button>
            </p>
          )}
        </>
      ) : error ? (
        <p className="hint sample-error">{error}</p>
      ) : !diff ? (
        <p className="hint">Comparing…</p>
      ) : (
        <>
          <p className="hint">
            Since <strong>{baseline.name}</strong>:{' '}
            {entities.length === 0 && diff.arrows.length === 0
              ? 'no changes to the ontology.'
              : `${count('added')} added, ${count('changed')} changed, ${count('removed')} removed.`}
          </p>
          <p className="hint diff-legend">
            {(['added', 'changed', 'removed'] as const).map((s) => (
              <span key={s} style={{ color: DIFF_COLORS[s] }}>
                ■ {s}
              </span>
            ))}
            <span>Removed classes show dashed where the file drew them, when it was exported from here.</span>
          </p>
          <div className="diff-list">
            {(['added', 'changed', 'removed'] as const)
              .filter((s) => count(s) > 0)
              .map((s) => (
                <section key={s}>
                  <h3 style={{ color: DIFF_COLORS[s] }}>{HEADINGS[s]}</h3>
                  <ul>
                    {entities
                      .filter((e) => e.status === s)
                      .map((e) => {
                        const target = s === 'removed' ? undefined : targets.get(e.iri)
                        return (
                          <li key={e.iri}>
                            <div className="diff-entity">
                              {target ? (
                                <button className="page-chip" title={e.iri} onClick={() => onShow(target)}>
                                  {e.label}
                                </button>
                              ) : (
                                <span title={e.iri}>{e.label}</span>
                              )}{' '}
                              <span className="muted">{e.kind === 'other' ? '' : e.kind}</span>
                            </div>
                            <ul className="diff-changes">
                              {e.changes.map((c, i) => (
                                <li key={i} className={c.sign === '+' ? 'diff-plus' : 'diff-minus'}>
                                  {c.sign} {c.text}
                                </li>
                              ))}
                            </ul>
                          </li>
                        )
                      })}
                  </ul>
                </section>
              ))}
          </div>
        </>
      )}
    </aside>
  )
}
