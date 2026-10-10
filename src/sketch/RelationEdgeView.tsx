import { EdgeLabelRenderer, getBezierPath, Position, useNodesData, useReactFlow, useStoreApi, type EdgeProps } from '@xyflow/react'
import { useMemo, type MouseEvent, type PointerEvent } from 'react'
import type { ClassNode, RelationEdge } from '../model'
import { bendThrough, bentPath, type Point } from './curve'
import { constraintOnArrow, multiplicity, nearTarget } from './multiplicity'
import { roughPath, seedFor } from './rough'
import { dashArray, EDGE_DEFAULTS } from './style'

// Which way a default bezier leaves its target handle, to set the multiplicity beside the arrowhead.
const OUTWARD: Record<Position, Point> = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
}

export function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const { id, data, markerEnd, selected, source: sourceId, sourceX, sourceY, targetX, targetY, targetPosition } = props
  const { getEdge, screenToFlowPosition, updateEdgeData } = useReactFlow<ClassNode, RelationEdge>()
  const store = useStoreApi<ClassNode, RelationEdge>()
  const sourceClass = useNodesData<ClassNode>(sourceId)
  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }

  // Unbent edges keep React Flow's default bezier; dragging the midpoint handle bends them.
  let d: string
  let mid: { x: number; y: number }
  // A point the line heads for as it leaves the target.
  let towards: Point
  if (data?.bend) {
    const bent = bentPath(source, target, data.bend)
    d = bent.d
    mid = bent.through
    towards = bent.control
  } else {
    const [path, labelX, labelY] = getBezierPath(props)
    d = path
    mid = { x: labelX, y: labelY }
    towards = { x: target.x + OUTWARD[targetPosition].x, y: target.y + OUTWARD[targetPosition].y }
  }

  // The SHACL counts the source class puts on this property, shown by the arrowhead as in UML.
  const constraint =
    data?.kind === 'objectProperty' ? constraintOnArrow(sourceClass?.data.constraints, data.label, (e) => getEdge(e)?.data?.label) : undefined
  const counts = constraint && multiplicity(constraint)
  const countsAt = nearTarget(target, towards)
  // Clicking the counts selects the class that holds the constraint, so the inspector shows it.
  // React passes the click up to the edge through the label portal; stop it there so the edge doesn't take the selection.
  const openConstraint = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    store.getState().addSelectedNodes([sourceId])
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
        {counts && (
          <button
            className="edge-multiplicity nodrag nopan"
            title={`SHACL: each ${sourceClass?.data.label ?? 'instance'} needs ${counts} "${data?.label}" values. Click to edit the constraint.`}
            style={{ transform: `translate(-50%, -50%) translate(${countsAt.x}px, ${countsAt.y}px)` }}
            onClick={openConstraint}
          >
            {counts}
          </button>
        )}
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
