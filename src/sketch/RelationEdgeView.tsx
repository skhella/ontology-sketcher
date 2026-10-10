import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useMemo } from 'react'
import type { RelationEdge } from '../model'
import { roughPath, seedFor } from './rough'

export function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const { id, data, markerEnd, selected } = props
  const [d, labelX, labelY] = getBezierPath(props)
  const isSubClass = data?.kind === 'subClassOf'

  const paths = useMemo(
    () =>
      roughPath(d, {
        seed: seedFor(id),
        roughness: 1,
        stroke: selected ? '#1971c2' : '#1e1e1e',
        strokeWidth: 1.5,
      }),
    [d, id, selected],
  )
  const label = isSubClass ? 'subClassOf' : data?.label

  return (
    <>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={isSubClass ? undefined : '8 6'} fill="none" />
      ))}
      {/* Invisible copies of the smooth path: one carries the arrow marker (sized by its stroke width), one widens the hit area. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={1.5} markerEnd={markerEnd} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="react-flow__edge-interaction" />
      <EdgeLabelRenderer>
        <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
