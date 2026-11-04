import { renameNote, type OntologyDiff, type Status } from './diff'
import type { CanvasTarget } from './canvasTargets'
import { DIFF_COLORS, type DiffShow } from './diffCanvas'
import { FloatingPanel } from './FloatingPanel'


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
  /** Which changes are listed and coloured on the canvas: all, or only one kind. */
  show: DiffShow
  onShowOnly: (show: DiffShow) => void
  /** Pages only the file has, with classes only the file has on them, see pagesOnlyInFile; and adding an empty page of that name to see them. */
  filePages: string[]
  onAddPage: (name: string) => void
  onChooseFile: () => void
  onUseImported: () => void
  onShow: (target: CanvasTarget) => void
  onClose: () => void
}

const HEADINGS: Record<Status, string> = { added: 'Added', changed: 'Changed', removed: 'Removed' }

/** What changed since an earlier file, see diff.ts; the canvas colours the same changes while this is open. */
export function DiffPanel({ baseline, imported, diff, error, targets, pageId, pageNames, fileIsNewer, onFileIsNewer, show, onShowOnly, filePages, onAddPage, onChooseFile, onUseImported, onShow, onClose }: Props) {
  const entities = diff?.entities ?? []
  const count = (s: Status) => entities.filter((e) => e.status === s).length
  const renamed = entities.filter((e) => e.renamedFrom).length
  return (
    <FloatingPanel name="compare" className="property-hierarchy diff-panel" aria-label="Compare with a file">
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
              : `${count('added')} added, ${count('changed')} changed, ${count('removed')} removed${renamed ? `, of which ${renamed} probably renamed` : ''}.`}
          </p>
          <div className="segmented diff-filter" role="radiogroup" aria-label="Which changes to show">
            {(['all', 'added', 'changed', 'removed'] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={show === s}
                className={show === s ? 'active' : undefined}
                title={s === 'all' ? 'Show every change' : `Show only ${s} classes and properties, here and on the canvas`}
                onClick={() => onShowOnly(s)}
              >
                {s === 'all' ? 'All' : <><span style={{ color: DIFF_COLORS[s] }}>■</span> {HEADINGS[s]} {count(s)}</>}
              </button>
            ))}
          </div>
          <p className="hint diff-legend">
            <span>
              Click an underlined name to go to it on the canvas and see what changed there. Only the open page is coloured.{' '}
              {fileIsNewer ? 'Added' : 'Removed'} classes show dashed where the file drew them, when it was exported from here.
            </span>
          </p>
          {filePages.length > 0 && (show === 'all' || show === (fileIsNewer ? 'added' : 'removed')) && (
            <p className="hint">
              Only the file has {filePages.length === 1 ? 'the page' : 'the pages'}{' '}
              {filePages.map((name, i) => (
                <span key={name}>
                  {i > 0 && ', '}
                  <button className="page-chip" title={`Add an empty page "${name}" to see where the file drew its classes`} onClick={() => onAddPage(name)}>
                    {name} +
                  </button>
                </span>
              ))}
              . Add an empty page of that name to see its {fileIsNewer ? 'added' : 'removed'} classes there.
            </p>
          )}
          {show !== 'all' && count(show) === 0 && <p className="hint">Nothing {show}.</p>}
          <div className="diff-list">
            {(['added', 'changed', 'removed'] as const)
              .filter((s) => count(s) > 0 && (show === 'all' || show === s))
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
                                <button className="diff-jump" title={`Go to ${e.label} on the canvas (${e.iri})`} onClick={() => onShow(target)}>
                                  {e.label} ↗
                                </button>
                              ) : (
                                <span title={`${e.iri}: ${e.status === (fileIsNewer ? 'added' : 'removed') ? 'only in the file' : 'not drawn on any page'}, so there is nothing to go to`}>
                                  {e.label}
                                </span>
                              )}{' '}
                              <span className="muted">
                                {e.kind === 'other' ? '' : e.kind}
                                {target && target.pageId !== pageId && ` · on ${pageNames.get(target.pageId) ?? 'another page'}`}
                                {!target && (e.status === (fileIsNewer ? 'added' : 'removed') ? ' · only in the file' : ' · not drawn on any page')}
                              </span>
                            </div>
                            {renameNote(e) && (
                              <div className="diff-rename" title={`${e.renamedFrom?.iri ?? e.renamedTo?.iri}: an IRI only in one version that looks like the same ${e.kind}`}>
                                {renameNote(e)}
                              </div>
                            )}
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
    </FloatingPanel>
  )
}
