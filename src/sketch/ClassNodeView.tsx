import { Handle, useConnection, useInternalNode, type NodeProps } from '@xyflow/react'
import { Fragment, useMemo } from 'react'
import type { ClassNode } from '../model'
import { breakPoints } from './label'
import { roughRect, seedFor } from './rough'
import { boxOf, CLASS_HEIGHT as HEIGHT, CLASS_WIDTH as WIDTH, SIDES, snapToClass } from './snap'
import { dashArray, nodeStyle, roughNodeOptions } from './style'

export function ClassNodeView({ id, data, selected }: NodeProps<ClassNode>) {
  const style = data.style
  // The width is fixed; a long label wraps and the box grows taller, so the outline follows the measured height.
  const internal = useInternalNode<ClassNode>(id)
  const height = Math.max(HEIGHT, internal?.measured.height ?? HEIGHT)
  const paths = useMemo(() => roughRect(WIDTH, height, roughNodeOptions(style, seedFor(id))), [id, style, height])
  const { strokeStyle, strokeWidth } = nodeStyle(style)

  // While a new edge is dragged over this class, highlight the dot it will lock to.
  // `to` is the pointer in flow coordinates, or the dot React Flow itself snapped to.
  const position = internal?.internals.positionAbsolute
  const measured = internal?.measured
  const snapSide = useConnection((c) =>
    c.inProgress && position ? (snapToClass([boxOf({ id, position, measured })], c.to, c.fromNode.id)?.side ?? null) : null,
  )

  return (
    <div className={`class-node${selected ? ' selected' : ''}${snapSide ? ' snap-target' : ''}`} style={{ width: WIDTH, minHeight: HEIGHT }}>
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
      <span className="label">
        {breakPoints(data.label).map((piece, i) => (
          <Fragment key={i}>
            {i > 0 && <wbr />}
            {piece}
          </Fragment>
        ))}
      </span>
      {/* One dot per side. With ConnectionMode.Loose any dot can start or end an edge; the id is the side. */}
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={side} className={side === snapSide ? 'snapped' : undefined} />
      ))}
    </div>
  )
}
