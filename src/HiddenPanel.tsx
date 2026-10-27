import { useState, type ReactNode } from 'react'
import type { CanvasTarget } from './canvasTargets'
import type { HiddenEntry, HiddenItems, HiddenLine } from './hiddenItems'

type Props = {
  items: HiddenItems
  targets: Map<string, CanvasTarget>
  onShow: (target: CanvasTarget) => void
  onClose: () => void
}

/**
 * Everything kept from an import that the canvas doesn't draw (see hiddenItems.ts), read only, so nothing in a file
 * is out of sight. The export writes all of it back. Names drawn on a page can be clicked to show them.
 */
export function HiddenPanel({ items, targets, onShow, onClose }: Props) {
  const [filter, setFilter] = useState('')
  const match = (entry: { name: string; lines?: HiddenLine[]; text?: string }) => {
    const f = filter.trim().toLowerCase()
    return !f || [entry.name, entry.text ?? '', ...(entry.lines ?? []).map((l) => `${l.predicate} ${l.value}`)].some((s) => s.toLowerCase().includes(f))
  }
  const name = (text: string, iri?: string) => {
    const target = iri && targets.get(iri)
    return target ? (
      <button className="diff-jump" title={`${iri}\nShow on the canvas`} onClick={() => onShow(target)}>
        {text}
      </button>
    ) : (
      <span title={iri}>{text}</span>
    )
  }
  const entry = (e: HiddenEntry) => (
    <li key={e.iri ?? e.name + e.lines.map((l) => l.value).join()}>
      <div className="hidden-name">{name(e.name, e.iri)}</div>
      <Lines lines={e.lines} name={name} />
    </li>
  )
  const individuals = items.individuals.map((g) => ({ ...g, entries: g.entries.filter(match) })).filter((g) => g.entries.length > 0)
  const properties = items.properties.filter(match)
  const axioms = items.axioms.filter(match)
  const aboutDrawn = items.aboutDrawn.filter(match)
  const other = items.other.filter(match)
  const individualCount = individuals.reduce((n, g) => n + g.entries.length, 0)

  return (
    <aside className="property-hierarchy hidden-panel" aria-label="Not on the canvas">
      <div className="export-actions">
        <strong>Not on the canvas</strong>
        <button onClick={onClose}>Close</button>
      </div>
      {items.count === 0 ? (
        <p className="hint">Everything in the project is drawn. What an import can't draw (individuals, complex axioms, properties without a class) is listed here.</p>
      ) : (
        <>
          <p className="hint">Kept from imports and written back by the export, but not drawn. Underlined names are on a page: click to show them.</p>
          <input className="hidden-filter" value={filter} placeholder="Filter" aria-label="Filter" onChange={(e) => setFilter(e.target.value)} />
          <div className="hidden-sections">
            <Section title="Individuals" count={individualCount}>
              {individuals.map((g) => (
                <details key={g.type ?? ''} open={individuals.length === 1 || !!filter.trim()}>
                  <summary>
                    {name(g.typeName, g.type)} <span className="muted">({g.entries.length})</span>
                  </summary>
                  <ul>{g.entries.map(entry)}</ul>
                </details>
              ))}
            </Section>
            <Section title="Class axioms the inspector can't show" count={axioms.length}>
              <ul>
                {axioms.map((a, i) => (
                  <li key={`${a.about}-${i}`}>
                    <div className="hidden-name">{name(a.name, a.about)}</div>
                    <code className="hidden-axiom">{a.text}</code>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Properties without a class to draw them on" count={properties.length}>
              <ul>
                {properties.map((p) => (
                  <li key={p.iri}>
                    <div className="hidden-name">
                      {name(p.name, p.iri)} <span className="muted">({p.kind} property)</span>
                    </div>
                    <Lines lines={p.lines} name={name} />
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="More about things on the canvas" count={aboutDrawn.length}>
              <ul>{aboutDrawn.map(entry)}</ul>
            </Section>
            <Section title="Other statements" count={other.length}>
              <ul>{other.map(entry)}</ul>
            </Section>
          </div>
        </>
      )}
    </aside>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section>
      <h3>
        {title} <span className="muted">({count})</span>
      </h3>
      {children}
    </section>
  )
}

function Lines({ lines, name }: { lines: HiddenLine[]; name: (text: string, iri?: string) => ReactNode }) {
  if (lines.length === 0) return null
  return (
    <dl className="hidden-lines">
      {lines.map((l, i) => (
        <div key={i}>
          <dt>{l.predicate}</dt>
          <dd>{name(l.value, l.iri)}</dd>
        </div>
      ))}
    </dl>
  )
}
