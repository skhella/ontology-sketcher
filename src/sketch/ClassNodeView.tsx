import { Handle, useConnection, useInternalNode, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ClassNode } from '../model'
import { NamespacesContext } from '../namespaceContext'
import { prefixOf } from '../namespaces'
import { breakPoints } from './label'
import { roughEllipse, roughRect, seedFor } from './rough'
import { ANCHORS, boxOf, CLASS_HEIGHT as HEIGHT, CLASS_WIDTH as WIDTH, cornerFraction, handlePosition, isCorner, snapToClass, type Anchor } from './snap'
import { dashArray, nodeStyle, roughNodeOptions } from './style'

export function ClassNodeView({ id, data, selected }: NodeProps<ClassNode>) {
  const style = data.style
  const { strokeStyle, strokeWidth, shape, stroke, fill } = nodeStyle(style)
  const oval = shape === 'oval'
  const prefix = prefixOf(useContext(NamespacesContext), data.namespace)

  // An oval only holds text inside its inscribed rectangle, which is 1/√2 of its height,
  // so it grows taller than the label (the label's side padding covers the width).
  const label = useRef<HTMLSpanElement>(null)
  const labelHeight = useLabelHeight(label)
  const minHeight = oval ? Math.max(HEIGHT, Math.ceil(labelHeight * Math.SQRT2) + 12) : HEIGHT

  // The width is fixed; a long label wraps and the box grows taller, so the outline follows the measured height.
  const internal = useInternalNode<ClassNode>(id)
  const height = Math.max(minHeight, internal?.measured.height ?? HEIGHT)
  const paths = useMemo(
    () => (oval ? roughEllipse : roughRect)(WIDTH, height, roughNodeOptions(style, seedFor(id))),
    [id, style, height, oval],
  )

  // Switching between box and oval moves the corner dots without resizing the class, so React Flow has to measure them again.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => updateNodeInternals(id), [id, oval, updateNodeInternals])

  // While a new edge is dragged over this class, highlight the dot it will lock to.
  // `to` is the pointer in flow coordinates, or the dot React Flow itself snapped to.
  const position = internal?.internals.positionAbsolute
  const measured = internal?.measured
  const snapSide = useConnection((c) =>
    c.inProgress && position ? (snapToClass([boxOf({ id, position, measured, data })], c.to, c.fromNode.id)?.side ?? null) : null,
  )

  return (
    <div
      className={`class-node${oval ? ' oval' : ''}${selected ? ' selected' : ''}${snapSide ? ' snap-target' : ''}`}
      style={{ width: WIDTH, minHeight }}
    >
      <svg width={WIDTH} height={height} className="sketch">
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            stroke={p.stroke}
            strokeWidth={p.strokeWidth}
            fill={p.fill ?? 'none'}
            // rough.js emits the fill first and the outline last; only the outline is dashed.
            strokeDasharray={i === paths.length - 1 ? dashArray(strokeStyle, strokeWidth) : undefined}
          />
        ))}
      </svg>
      <span className="label" ref={label}>
        {breakPoints(data.label).map((piece, i) => (
          <Fragment key={i}>
            {i > 0 && <wbr />}
            {piece}
          </Fragment>
        ))}
      </span>
      {/* SKOS concepts and schemes carry a tab on their top edge, so they stay apart from classes whatever shape and colour they get. */}
      {data.kind && (
        <span className="kind-badge" style={{ color: stroke, borderColor: stroke, background: fill === 'transparent' ? undefined : fill }}>
          {data.kind}
        </span>
      )}
      {data.namespace && (
        <span className="namespace-badge" style={{ color: stroke, borderColor: stroke }} title={data.namespace}>
          {prefix ?? 'other'}:
        </span>
      )}
      {/* Eight dots: one per side and one per corner. With ConnectionMode.Loose any dot can start or end an edge; the id is the anchor. */}
      {ANCHORS.map((anchor) => (
        <Handle
          key={anchor}
          id={anchor}
          type="source"
          position={handlePosition(anchor)}
          className={anchor === snapSide ? 'snapped' : undefined}
          style={cornerStyle(anchor, oval)}
        />
      ))}
    </div>
  )
}

/** A corner dot sits on the box's corner or at 45° on the oval, centred on that point. */
function cornerStyle(anchor: Anchor, oval: boolean) {
  if (!isCorner(anchor)) return undefined
  const f = cornerFraction(anchor, oval)
  return { left: `${f.x * 100}%`, top: `${f.y * 100}%`, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }
}

/** Rendered height of the label, kept current as it wraps or its text changes. */
function useLabelHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    setHeight(element.offsetHeight)
    return () => observer.disconnect()
  }, [ref])
  return height
}
