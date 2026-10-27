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
  /** The page being drawn, and every page's name: an entity on another page says which. */
  pageId: string
  pageNames: Map<string, string>
  /** Whether the file is a later version than the canvas rather than an earlier one. */
  fileIsNewer: boolean
  onFileIsNewer: (newer: boolean) => void
  onChooseFile: () => void
  onUseImported: () => void
  onShow: (target: CanvasTarget) => void
  onClose: () => void
}

const HEADINGS: Record<Status, string> = { added: 'Added', changed: 'Changed', removed: 'Removed' }

/** What changed since an earlier file, see diff.ts; the canvas colours the same changes while this is open. */
export function DiffPanel({ baseline, imported, diff, error, targets, pageId, pageNames, fileIsNewer, onFileIsNewer, onChooseFile, onUseImported, onShow, onClose }: Props) {
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
          <p className="hint">Compare the canvas with another version as a Turtle file: an earlier one such as a previous export, or a newer one. Changes are coloured on the canvas.</p>
          {imported && (
            <p className="hint">
              <button onClick={onUseImported}>Compare with {imported.name} (imported)</button>
            </p>
          )}
        </>
      ) : (
        <div className="segmented diff-direction" role="radiogroup" aria-label="Which version the file is">
          <span className="muted">{baseline.name} is</span>
          {[false, true].map((newer) => (
            <button key={String(newer)} role="radio" aria-checked={fileIsNewer === newer} className={fileIsNewer === newer ? 'active' : undefined} onClick={() => onFileIsNewer(newer)}>
              {newer ? 'newer' : 'older'}
            </button>
          ))}
        </div>
      )}
      {!baseline ? null : error ? (
        <p className="hint sample-error">{error}</p>
      ) : !diff ? (
        <p className="hint">Comparing…</p>
      ) : (
        <>
          <p className="hint">
            {fileIsNewer ? (
              <>
                From the canvas to <strong>{baseline.name}</strong>:{' '}
              </>
            ) : (
              <>
                Since <strong>{baseline.name}</strong>:{' '}
              </>
            )}
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
            <span>
              The open page is coloured; names on other pages say which page. {fileIsNewer ? 'Added' : 'Removed'} classes show dashed where the file
              drew them, when it was exported from here.
            </span>
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
                        const target = targets.get(e.iri)
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
                              <span className="muted">
                                {e.kind === 'other' ? '' : e.kind}
                                {target && target.pageId !== pageId && ` · on ${pageNames.get(target.pageId) ?? 'another page'}`}
                              </span>
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
