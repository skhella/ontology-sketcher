import type { Page } from '../pages'

type Props = {
  classId: string
  label: string
  pages: Page[]
  pageId: string
  onOpen: (pageId: string) => void
  /** Links a page to this class, or with undefined unlinks it. */
  onLink: (pageId: string, classId: string | undefined) => void
  onNewPage: () => void
}

/** The class's detail page, which its "page" tab on the canvas opens, and the other pages that show it. */
export function ClassPages({ classId, label, pages, pageId, onOpen, onLink, onNewPage }: Props) {
  const detail = pages.find((p) => p.classId === classId)
  const shownOn = pages.filter((p) => p.id === pageId || p.nodes.some((n) => n.id === classId))
  const pick = (value: string) => {
    if (value === 'new') onNewPage()
    else if (value) onLink(value, classId)
    else if (detail) onLink(detail.id, undefined)
  }
  return (
    <fieldset className="class-pages">
      <legend>Pages</legend>
      <label className="field">
        <span className="field-label">Detail page</span>
        <select value={detail?.id ?? ''} onChange={(e) => pick(e.target.value)} title="A page about this class; its tab on the canvas opens it">
          <option value="">none</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">New page "{label}"</option>
        </select>
      </label>
      <span className="field-label">Shown on</span>
      <div className="page-list">
        {shownOn.map((p) =>
          p.id === pageId ? (
            <span key={p.id} className="muted">
              {p.name} (this page)
            </span>
          ) : (
            <button key={p.id} onClick={() => onOpen(p.id)} title={`Open page "${p.name}"`}>
              {p.name}
            </button>
          ),
        )}
      </div>
    </fieldset>
  )
}
