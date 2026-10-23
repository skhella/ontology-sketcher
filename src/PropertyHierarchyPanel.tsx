import { useState } from 'react'
import { propertyTrees, type PropertyEntry, type PropertyTree } from './propertyHierarchy'

type Props = {
  entries: Map<string, PropertyEntry>
  pageId: string
  onOpenPage: (id: string) => void
  onClose: () => void
}

/** Protégé's object and data property hierarchies: every property of the project by rdfs:subPropertyOf. Read only. */
export function PropertyHierarchy({ entries, pageId, onOpenPage, onClose }: Props) {
  const [kind, setKind] = useState<PropertyEntry['kind']>('object')
  const trees = propertyTrees(entries, kind)
  const count = (k: PropertyEntry['kind']) => [...entries.values()].filter((e) => e.kind === k && !e.outside).length

  return (
    <aside className="property-hierarchy" aria-label="Property hierarchy">
      <div className="export-actions">
        <strong>Properties</strong>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="segmented" role="tablist" aria-label="Property kind">
        {(['object', 'data'] as const).map((k) => (
          <button key={k} role="tab" className={k === kind ? 'active' : undefined} aria-selected={k === kind} onClick={() => setKind(k)}>
            {k === 'object' ? 'Object' : 'Data'} ({count(k)})
          </button>
        ))}
      </div>
      <p className="hint">
        Nested by subPropertyOf; set it on an arrow in the inspector. Dashed entries come from another ontology. Click a page to open it.
      </p>
      {trees.length === 0 ? (
        <p className="hint">No {kind} properties yet.</p>
      ) : (
        <ul className="property-tree">
          {trees.map((t) => (
            <Branch key={t.entry.iri} tree={t} pageId={pageId} onOpenPage={onOpenPage} />
          ))}
        </ul>
      )}
    </aside>
  )
}

function Branch({ tree: { entry, children }, pageId, onOpenPage }: { tree: PropertyTree; pageId: string; onOpenPage: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const where = entry.outside ? 'From another ontology' : entry.kept ? 'Kept from the import, not drawn' : undefined
  return (
    <li>
      <div className={`property-row${entry.outside ? ' outside' : ''}`}>
        {children.length > 0 ? (
          <button className="twisty" aria-expanded={open} aria-label={open ? `Collapse ${entry.label}` : `Expand ${entry.label}`} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <span className="property-name" title={entry.iri}>
          {entry.label}
        </span>
        {(entry.domains.length > 0 || entry.ranges.length > 0) && (
          <span className="muted">
            {entry.domains.join(' ⊔ ') || '…'} → {entry.ranges.join(' ⊔ ') || '…'}
          </span>
        )}
        {where && <span className="muted">({where})</span>}
        {entry.pages.map((p) => (
          <button key={p.id} className={`page-chip${p.id === pageId ? ' active' : ''}`} onClick={() => onOpenPage(p.id)} title={`Open ${p.name}`}>
            {p.name}
          </button>
        ))}
      </div>
      {open && children.length > 0 && (
        <ul>
          {children.map((c) => (
            <Branch key={c.entry.iri} tree={c} pageId={pageId} onOpenPage={onOpenPage} />
          ))}
        </ul>
      )}
    </li>
  )
}
