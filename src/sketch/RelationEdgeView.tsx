import { EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { useMemo, type PointerEvent } from 'react'
import type { ClassNode, RelationEdge } from '../model'
import { bendThrough, bentPath } from './curve'
import { roughPath, seedFor } from './rough'
import { dashArray, EDGE_DEFAULTS } from './style'

export function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const { id, data, markerEnd, selected, sourceX, sourceY, targetX, targetY } = props
  const { screenToFlowPosition, updateEdgeData } = useReactFlow<ClassNode, RelationEdge>()
  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }

  // Unbent edges keep React Flow's default bezier; dragging the midpoint handle bends them.
  let d: string
  let mid: { x: number; y: number }
  if (data?.bend) {
    const bent = bentPath(source, target, data.bend)
    d = bent.d
    mid = bent.through
  } else {
    const [path, labelX, labelY] = getBezierPath(props)
    d = path
    mid = { x: labelX, y: labelY }
  }

  const isSubClass = data?.kind === 'subClassOf'
  const style = { ...EDGE_DEFAULTS, ...data?.style }
  const paths = useMemo(
    () => roughPath(d, { seed: seedFor(id), roughness: style.roughness, stroke: style.stroke, strokeWidth: style.strokeWidth }),
    [d, id, style.roughness, style.stroke, style.strokeWidth],
  )
  // Without an explicit stroke style, the kind decides: solid for subClassOf, dashed for object properties.
  const dash = dashArray(style.strokeStyle ?? (isSubClass ? 'solid' : 'dashed'), style.strokeWidth)
  const label = isSubClass ? 'subClassOf' : data?.label

  const startBend = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveBend = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    updateEdgeData(id, { bend: bendThrough(source, target, point) })
  }

  return (
    <>
      {selected && <path d={d} fill="none" className="edge-selection" strokeWidth={style.strokeWidth + 8} />}
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={dash} fill="none" />
      ))}
      {/* Invisible copies of the smooth path: one carries the arrow marker (sized by its stroke width), one widens the hit area. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={1.5} markerEnd={markerEnd} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="react-flow__edge-interaction" />
      <EdgeLabelRenderer>
        {/* While selected, the label moves up so the bend handle does not cover it. */}
        <div className="edge-label" style={{ transform: `translate(-50%, ${selected ? '-130%' : '-50%'}) translate(${mid.x}px, ${mid.y}px)` }}>
          {label}
        </div>
        {selected && (
          <div
            className="bend-handle nodrag nopan"
            title="Drag to curve the edge, double-click to reset"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
            onPointerDown={startBend}
            onPointerMove={moveBend}
            onDoubleClick={() => updateEdgeData(id, { bend: undefined })}
          />
        )}
      </EdgeLabelRenderer>
    </>
  )
}
