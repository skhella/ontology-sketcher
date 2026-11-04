import { useStore } from '@xyflow/react'
import { useContext } from 'react'
import { renameNote } from '../diff'
import { DIFF_COLORS } from '../diffCanvas'
import { DiffBadgeContext } from '../diffBadgeContext'

const BADGE = { added: 'new', changed: 'changed', removed: 'removed' } as const

/** While comparing, the tag on a coloured class or arrow, which opens what changed on it; see diffCanvas.ts. */
export function DiffBadge({ id, what }: { id: string; what: 'class' | 'arrow' }) {
  const badges = useContext(DiffBadgeContext)
  const change = badges.changes.get(id)
  const open = !!change && badges.open === id
  // Zoomed out on a large ontology, the tag and its changes keep a readable size instead of shrinking with the canvas.
  const zoom = useStore((s) => s.transform[2])
  if (!change) return null
  const grow = Math.min(4, Math.max(1, 1 / zoom))
  const transform = grow > 1 ? `scale(${grow})` : undefined
  return (
    <>
      <button
        className="diff-badge nodrag nopan"
        style={{ background: DIFF_COLORS[change.status], transform }}
        aria-expanded={open}
        title={`What changed on this ${what}`}
        onClick={(event) => {
          event.stopPropagation()
          badges.setOpen(open ? null : id)
        }}
      >
        {BADGE[change.status]}
      </button>
      {open && (
        <div className="diff-popup nodrag nopan nowheel" style={{ borderColor: DIFF_COLORS[change.status], transform }} onClick={(event) => event.stopPropagation()}>
          <div className="diff-popup-head">
            <strong>{change.label}</strong> <span style={{ color: DIFF_COLORS[change.status] }}>{change.status}</span>
            <button className="remove" aria-label="Close" onClick={() => badges.setOpen(null)}>
              ×
            </button>
          </div>
          {renameNote(change) && <div className="diff-rename">{renameNote(change)}</div>}
          <ul className="diff-changes">
            {change.changes.map((c, i) => (
              <li key={i} className={c.sign === '+' ? 'diff-plus' : 'diff-minus'}>
                {c.sign} {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
