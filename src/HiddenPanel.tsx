import { useState, type ReactNode } from 'react'
import type { CanvasTarget } from './canvasTargets'
import { KeptPropertyEditor, StatementsEditor, type Naming } from './HiddenEditors'
import type { HiddenEntry, HiddenItems, HiddenLine } from './hiddenItems'
import type { KeptTriple } from './keptEdit'
import type { KeptProperty } from './model'

type Props = {
  items: HiddenItems
  targets: Map<string, CanvasTarget>
  onShow: (target: CanvasTarget) => void
  onClose: () => void
  /** For editing: the kept properties, how names read, and how a statement or a property changes. */
  edit?: {
    kept: KeptProperty[]
    naming: Naming
    onTriple: (old: KeptTriple | undefined, next: KeptTriple | undefined, about?: string) => void
    onProperty: (iri: string, patch: Partial<KeptProperty>) => void
  }
}

/**
 * Everything kept from an import that the canvas doesn't draw (see hiddenItems.ts), so nothing in a file is out of
 * sight. The export writes all of it back. Names drawn on a page can be clicked to show them. Plain statements about
 * a named thing, and properties drawn nowhere, can be edited (Edit next to their name).
 */
export function HiddenPanel({ items, targets, onShow, onClose, edit }: Props) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const editButton = (key: string) =>
    edit && (
      <button className="hidden-edit-toggle" aria-expanded={editing === key} onClick={() => setEditing(editing === key ? null : key)}>
        {editing === key ? 'Done' : 'Edit'}
      </button>
    )
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
  // `about` puts a statement added to a thing with nothing else kept about it with that drawn thing.
  const entry = (e: HiddenEntry, about?: string) => {
    const subject = e.iri
    return (
      <li key={e.iri ?? e.name + e.lines.map((l) => l.value).join()}>
        <div className="hidden-name">
          {name(e.name, e.iri)} {subject && editButton(subject)}
        </div>
        {edit && subject && editing === subject ? (
          <StatementsEditor subject={subject} lines={e.lines} naming={edit.naming} onEdit={(old, next) => edit.onTriple(old, next, about)} />
        ) : (
          <Lines lines={e.lines} name={name} />
        )}
      </li>
    )
  }
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
          <p className="hint">Kept from imports and written back by the export, but not drawn. Underlined names are on a page: click to show them. Edit changes what is written back.</p>
          <input className="hidden-filter" value={filter} placeholder="Filter" aria-label="Filter" onChange={(e) => setFilter(e.target.value)} />
          <div className="hidden-sections">
            <Section title="Individuals" count={individualCount}>
              {individuals.map((g) => (
                <details key={g.type ?? ''} open={individuals.length === 1 || !!filter.trim()}>
                  <summary>
                    {name(g.typeName, g.type)} <span className="muted">({g.entries.length})</span>
                  </summary>
                  <ul>{g.entries.map((e) => entry(e))}</ul>
                </details>
              ))}
            </Section>
            <Section title="Class axioms (edit them as text in the inspector)" count={axioms.length}>
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
                {properties.map((p) => {
                  const property = edit && editing === p.iri ? edit.kept.find((k) => k.iri === p.iri) : undefined
                  return (
                    <li key={p.iri}>
                      <div className="hidden-name">
                        {name(p.name, p.iri)} <span className="muted">({p.kind} property)</span> {editButton(p.iri)}
                      </div>
                      {edit && property ? (
                        <KeptPropertyEditor property={property} naming={edit.naming} onChange={(patch) => edit.onProperty(p.iri, patch)} />
                      ) : (
                        <Lines lines={p.lines} name={name} />
                      )}
                    </li>
                  )
                })}
              </ul>
            </Section>
            <Section title="More about things on the canvas" count={aboutDrawn.length}>
              <ul>{aboutDrawn.map((e) => entry(e, e.iri))}</ul>
            </Section>
            <Section title="Other statements" count={other.length}>
              <ul>{other.map((e) => entry(e))}</ul>
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
