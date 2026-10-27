import { useState } from 'react'
import { CHARACTERISTICS } from './inspector/characteristics'
import type { KeptTriple } from './keptEdit'
import type { HiddenLine } from './hiddenItems'
import type { KeptProperty } from './model'
import { shortName } from './vocab'

/** How the panel names things and reads names back (see projectNames.ts). */
export type Naming = { name: (iri: string) => string; resolve: (text: string) => string | undefined }

/**
 * The plain statements about one subject, editable: change a value (a name for an IRI, text for a literal), remove one,
 * or add one. `onEdit` swaps `old` for `next` (either may be missing) and throws with a message when it can't.
 */
export function StatementsEditor({
  subject,
  lines,
  naming,
  onEdit,
}: {
  subject: string
  lines: HiddenLine[]
  naming: Naming
  onEdit: (old: KeptTriple | undefined, next: KeptTriple | undefined) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const run = (f: () => void) => {
    try {
      f()
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const resolve = (text: string) => {
    const iri = naming.resolve(text)
    if (!iri) throw new Error(`Unknown name "${text}": use a label, prefix:local or a full IRI in <>`)
    return iri
  }
  const editable = lines.filter((l): l is HiddenLine & { edit: KeptTriple } => !!l.edit)
  return (
    <div className="hidden-edit">
      {editable.map((l) => (
        <ValueRow key={JSON.stringify(l.edit)} line={l} naming={naming} onChange={(next) => run(() => onEdit(l.edit, next(resolve)))} onRemove={() => run(() => onEdit(l.edit, undefined))} />
      ))}
      <AddRow onAdd={(predicate, value, kind) => run(() => onEdit(undefined, { subject, predicate: resolve(predicate), object: kind === 'iri' ? { kind, value: resolve(value) } : { kind, value } }))} />
      {error && <small className="sample-error">{error}</small>}
    </div>
  )
}

function ValueRow({
  line,
  naming,
  onChange,
  onRemove,
}: {
  line: HiddenLine & { edit: KeptTriple }
  naming: Naming
  onChange: (next: (resolve: (text: string) => string) => KeptTriple) => void
  onRemove: () => void
}) {
  const { object } = line.edit
  const shown = object.kind === 'iri' ? naming.name(object.value) : object.value
  const [value, setValue] = useState(shown)
  const [lang, setLang] = useState(object.lang ?? '')
  const apply = () => {
    if (value === shown && lang === (object.lang ?? '')) return
    onChange((resolve) => ({ ...line.edit, object: object.kind === 'iri' ? { kind: 'iri', value: resolve(value) } : { ...object, value, lang: lang.trim() || undefined } }))
  }
  return (
    <div className="annotation">
      <span className="property" title={line.edit.predicate}>
        {line.predicate}
      </span>
      <button className="remove" aria-label={`Remove ${line.predicate}`} onClick={onRemove}>
        ×
      </button>
      <input className="value" value={value} onChange={(e) => setValue(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} aria-label={`${line.predicate} value`} />
      {object.kind === 'iri' ? (
        <span className="lang datatype">IRI</span>
      ) : object.datatype ? (
        <span className="lang datatype" title={object.datatype}>
          {shortName(object.datatype)}
        </span>
      ) : (
        <input className="lang" value={lang} placeholder="lang" onChange={(e) => setLang(e.target.value)} onBlur={apply} aria-label={`${line.predicate} language`} />
      )}
    </div>
  )
}

function AddRow({ onAdd }: { onAdd: (predicate: string, value: string, kind: 'iri' | 'literal') => void }) {
  const [predicate, setPredicate] = useState('')
  const [value, setValue] = useState('')
  const [kind, setKind] = useState<'iri' | 'literal'>('literal')
  return (
    <div className="add-annotation">
      <input value={predicate} placeholder="property, e.g. skos:closeMatch" onChange={(e) => setPredicate(e.target.value)} aria-label="New statement property" />
      <input value={value} placeholder={kind === 'iri' ? 'name or <IRI>' : 'text'} onChange={(e) => setValue(e.target.value)} aria-label="New statement value" />
      <select value={kind} onChange={(e) => setKind(e.target.value as 'iri' | 'literal')} aria-label="Value kind">
        <option value="literal">text</option>
        <option value="iri">IRI</option>
      </select>
      <button
        disabled={!predicate.trim() || !value.trim()}
        onClick={() => {
          onAdd(predicate.trim(), value.trim(), kind)
          setValue('')
        }}
      >
        + Add
      </button>
    </div>
  )
}

/** A property kept from an import (see KeptProperty), editable: its label, domain and range by name, and characteristics. */
export function KeptPropertyEditor({ property, naming, onChange }: { property: KeptProperty; naming: Naming; onChange: (patch: Partial<KeptProperty>) => void }) {
  const names = (iris: string[] | undefined) => (iris ?? []).map(naming.name).join(' or ')
  const [label, setLabel] = useState(property.label)
  const [domains, setDomains] = useState(names(property.domains))
  const [ranges, setRanges] = useState(names(property.ranges))
  const [error, setError] = useState<string | null>(null)
  const read = (text: string) =>
    text
      .split(/\s+or\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const iri = naming.resolve(t)
        if (!iri) throw new Error(`Unknown name "${t}"`)
        return iri
      })
  const apply = (field: 'domains' | 'ranges', text: string) => {
    try {
      const iris = read(text)
      onChange({ [field]: iris.length > 0 ? iris : undefined })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const characteristics = new Set(property.characteristics ?? [])
  const toggle = (c: (typeof CHARACTERISTICS)[number]['key']) => {
    const next = characteristics.has(c) ? [...characteristics].filter((x) => x !== c) : [...characteristics, c]
    onChange({ characteristics: next.length > 0 ? next : undefined })
  }
  return (
    <div className="hidden-edit">
      <label className="hidden-field">
        label <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== property.label && onChange({ label })} />
      </label>
      <label className="hidden-field" title="Classes, joined with or">
        domain <input value={domains} placeholder="none" onChange={(e) => setDomains(e.target.value)} onBlur={() => apply('domains', domains)} />
      </label>
      <label className="hidden-field" title={property.kind === 'object' ? 'Classes, joined with or' : 'A datatype, e.g. xsd:dateTime'}>
        range <input value={ranges} placeholder="none" onChange={(e) => setRanges(e.target.value)} onBlur={() => apply('ranges', ranges)} />
      </label>
      <div className="characteristics">
        {CHARACTERISTICS.filter((c) => property.kind === 'object' || c.key === 'functional').map((c) => (
          <label key={c.key}>
            <input type="checkbox" checked={characteristics.has(c.key)} onChange={() => toggle(c.key)} /> {c.label}
          </label>
        ))}
      </div>
      {error && <small className="sample-error">{error}</small>}
    </div>
  )
}
