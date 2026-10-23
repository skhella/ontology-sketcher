import type { ReactNode } from 'react'
import {
  EDGE_DEFAULTS,
  FILL_COLORS,
  FILL_STYLES,
  NODE_DEFAULTS,
  CLASS_SHAPES,
  ROUGHNESS,
  STROKE_COLORS,
  STROKE_STYLES,
  STROKE_WIDTHS,
  type SketchStyle,
} from './style'

type Props = {
  /** Style of the first selected element, used to highlight the active options. */
  current: SketchStyle
  /** True when only edges are selected: hides background and fill options. */
  edgesOnly: boolean
  /** Number of selected edges that have been bent; enables "Straighten". */
  bentEdges: number
  /** True when everything selected is hidden on this page; the button then unhides instead. */
  hidden: boolean
  onHide: (hide: boolean) => void
  onChange: (patch: SketchStyle) => void
  onStraighten: () => void
}

/** Excalidraw-style properties panel for the selected nodes and edges. */
export function StylePanel({ current, edgesOnly, bentEdges, hidden, onHide, onChange, onStraighten }: Props) {
  const s = { ...(edgesOnly ? EDGE_DEFAULTS : NODE_DEFAULTS), ...current }

  return (
    <aside className="style-panel" aria-label="Style">
      {!edgesOnly && (
        <Section title="Shape">
          {CLASS_SHAPES.map((shape) => (
            <Option key={shape} label={shape} active={s.shape === shape} onPick={() => onChange({ shape })}>
              <ShapeIcon shape={shape} />
            </Option>
          ))}
        </Section>
      )}

      <Section title="Stroke">
        <Swatches colors={STROKE_COLORS} value={s.stroke} onPick={(stroke) => onChange({ stroke })} />
      </Section>

      {!edgesOnly && (
        <Section title="Background">
          <Swatches colors={FILL_COLORS} value={s.fill ?? ''} onPick={(fill) => onChange({ fill })} />
        </Section>
      )}

      {!edgesOnly && s.fill !== 'transparent' && (
        <Section title="Fill">
          {FILL_STYLES.map((fillStyle) => (
            <Option key={fillStyle} label={fillStyle} active={s.fillStyle === fillStyle} onPick={() => onChange({ fillStyle })}>
              <FillIcon fillStyle={fillStyle} />
            </Option>
          ))}
        </Section>
      )}

      <Section title="Stroke width">
        {STROKE_WIDTHS.map((strokeWidth, i) => (
          <Option
            key={strokeWidth}
            label={['thin', 'bold', 'extra bold'][i]}
            active={s.strokeWidth === strokeWidth}
            onPick={() => onChange({ strokeWidth })}
          >
            <LineIcon width={strokeWidth} />
          </Option>
        ))}
      </Section>

      <Section title="Stroke style">
        {STROKE_STYLES.map((strokeStyle) => (
          <Option key={strokeStyle} label={strokeStyle} active={s.strokeStyle === strokeStyle} onPick={() => onChange({ strokeStyle })}>
            <LineIcon width={2} dash={{ solid: undefined, dashed: '4 3', dotted: '0.5 3.5' }[strokeStyle]} />
          </Option>
        ))}
      </Section>

      <Section title="Sloppiness">
        {ROUGHNESS.map((roughness, i) => (
          <Option
            key={roughness}
            label={['architect', 'artist', 'cartoonist'][i]}
            active={Math.round(s.roughness ?? 1) === roughness}
            onPick={() => onChange({ roughness })}
          >
            <WiggleIcon amount={roughness} />
          </Option>
        ))}
      </Section>

      <Section title="On this page">
        <button
          className="text-option"
          onClick={() => onHide(!hidden)}
          title={
            hidden
              ? 'Draw it on this page again'
              : 'Leave it off this page and its SVG image (a class takes its arrows along); it stays in the ontology and every other export'
          }
        >
          {hidden ? 'Unhide' : 'Hide'}
        </button>
      </Section>

      {bentEdges > 0 && (
        <Section title="Curve">
          <button className="text-option" onClick={onStraighten}>
            Reset curve
          </button>
        </Section>
      )}
    </aside>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="options">{children}</div>
    </fieldset>
  )
}

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (color: string) => void }) {
  const custom = value !== 'transparent' && !colors.includes(value)
  return (
    <>
      {colors.map((color) => (
        <button
          key={color}
          className={`swatch${color === value ? ' active' : ''}${color === 'transparent' ? ' transparent' : ''}`}
          style={{ background: color === 'transparent' ? undefined : color }}
          title={color}
          aria-label={color}
          aria-pressed={color === value}
          onClick={() => onPick(color)}
        />
      ))}
      <label className={`swatch custom${custom ? ' active' : ''}`} title="Custom colour" style={custom ? { background: value } : undefined}>
        <input type="color" value={value.startsWith('#') ? value : '#000000'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </>
  )
}

function Option({ label, active, onPick, children }: { label: string; active: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button className={`option${active ? ' active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={onPick}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        {children}
      </svg>
    </button>
  )
}

function LineIcon({ width, dash }: { width: number; dash?: string }) {
  return <path d="M3 10 H17" stroke="currentColor" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
}

function WiggleIcon({ amount }: { amount: number }) {
  const d = ['M3 14 L17 6', 'M3 14 Q8 4 11 10 T17 6', 'M3 14 Q5 2 8 12 T12 8 T17 6'][amount]
  return <path d={d} stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" />
}

function ShapeIcon({ shape }: { shape: string }) {
  return shape === 'oval' ? (
    <ellipse cx="10" cy="10" rx="8" ry="5.5" stroke="currentColor" strokeWidth={1.5} fill="none" />
  ) : (
    <rect x="2" y="4.5" width="16" height="11" rx="1" stroke="currentColor" strokeWidth={1.5} fill="none" />
  )
}

function FillIcon({ fillStyle }: { fillStyle: string }) {
  const hatch = 'M4 12 L12 4 M4 16 L16 4 M8 16 L16 8'
  return (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" fill={fillStyle === 'solid' ? 'currentColor' : 'none'} />
      {fillStyle !== 'solid' && <path d={hatch} stroke="currentColor" />}
      {fillStyle === 'cross-hatch' && <path d="M4 8 L12 16 M4 4 L16 16 M8 4 L16 12" stroke="currentColor" />}
    </>
  )
}
