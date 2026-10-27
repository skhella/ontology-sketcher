import { useState } from 'react'
import { FloatingPanel } from './FloatingPanel'
import type { HiddenEntry } from './hidden'

type Props = {
  entries: HiddenEntry[]
  onUnhide: (ids: Set<string>) => void
  onClose: () => void
}

/** Everything marked hidden on this page, to unhide several at once instead of finding and clicking each. */
export function HiddenListPanel({ entries, onUnhide, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Something unhidden elsewhere (the style panel, undo) drops out of the list and out of the choice.
  const chosen = entries.filter((e) => picked.has(e.id))
  const all = entries.length > 0 && chosen.length === entries.length
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const unhide = (ids: Set<string>) => {
    onUnhide(ids)
    setPicked(new Set())
  }

  return (
    <FloatingPanel name="hidden-list" className="property-hierarchy hidden-list" aria-label="Hidden on this page">
      <div className="export-actions">
        <strong>Hidden on this page</strong>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="hint">Classes and arrows marked hidden here. An arrow of a hidden class isn't listed: it comes back with its class.</p>
      {entries.length === 0 ? (
        <p className="hint">Nothing is hidden on this page.</p>
      ) : (
        <>
          <label className="hidden-row">
            <input
              type="checkbox"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = chosen.length > 0 && !all
              }}
              onChange={() => setPicked(all ? new Set() : new Set(entries.map((e) => e.id)))}
            />
            <strong>Select all ({entries.length})</strong>
          </label>
          <ul className="hidden-items">
            {entries.map((e) => (
              <li key={e.id}>
                <label className="hidden-row">
                  <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                  <span>{e.label}</span>
                  <span className="muted">{e.kind}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="hidden-actions">
            <button disabled={chosen.length === 0} onClick={() => unhide(new Set(chosen.map((e) => e.id)))}>
              Unhide selected{chosen.length > 0 ? ` (${chosen.length})` : ''}
            </button>
            <button onClick={() => unhide(new Set(entries.map((e) => e.id)))}>Unhide all</button>
          </div>
        </>
      )}
    </FloatingPanel>
  )
}
