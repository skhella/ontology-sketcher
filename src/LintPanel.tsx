import type { Finding, Severity } from './lint'
import type { CanvasTarget } from './canvasTargets'
import { FloatingPanel } from './FloatingPanel'

type Props = {
  /** Undefined while the first check runs. */
  findings: Finding[] | undefined
  error?: string
  targets: Map<string, CanvasTarget>
  onShow: (target: CanvasTarget) => void
  onClose: () => void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const HEADINGS: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', info: 'Notes' }

/** Checks on the ontology itself (see lint.ts), kept up to date while open. Click a name to show it on the canvas. */
export function LintPanel({ findings, error, targets, onShow, onClose }: Props) {
  const count = (s: Severity) => findings?.filter((f) => f.severity === s).length ?? 0
  return (
    <FloatingPanel name="lint" className="property-hierarchy lint-panel" aria-label="Ontology check">
      <div className="export-actions">
        <strong>Check ontology</strong>
        <button onClick={onClose}>Close</button>
      </div>
      {error ? (
        <p className="hint sample-error">{error}</p>
      ) : !findings ? (
        <p className="hint">Checking…</p>
      ) : findings.length === 0 ? (
        <p className="hint">Nothing to report: no clashing declarations, cycles, gaps or shapes pointing at missing terms.</p>
      ) : (
        <>
          <p className="hint">
            {plural(count('error'), 'error')}, {plural(count('warning'), 'warning')}, {plural(count('info'), 'note')}. Click a name to show it on the canvas.
          </p>
          <div className="lint-findings">
            {(['error', 'warning', 'info'] as const)
              .filter((s) => count(s) > 0)
              .map((s) => (
                <section key={s}>
                  <h3 className={`lint-${s}`}>{HEADINGS[s]}</h3>
                  <ul>
                    {findings
                      .filter((f) => f.severity === s)
                      .map((f, i) => (
                        <li key={`${f.kind}-${i}`}>
                          <div className="lint-title">{f.title}</div>
                          <div className="lint-why">{f.explanation}</div>
                          <div className="lint-entities">
                            {f.entities.map((e) => {
                              const target = targets.get(e.iri)
                              return target ? (
                                <button key={e.iri} className="page-chip" title={e.iri} onClick={() => onShow(target)}>
                                  {e.label}
                                </button>
                              ) : (
                                <span key={e.iri} className="muted" title={`${e.iri} (not drawn on any page)`}>
                                  {e.label}
                                </span>
                              )
                            })}
                          </div>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
          </div>
        </>
      )}
    </FloatingPanel>
  )
}
