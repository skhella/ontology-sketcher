import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useMemo } from 'react'
import type { ClassNode } from '../model'
import { roughRect, seedFor } from './rough'
import { dashArray, nodeStyle, roughNodeOptions } from './style'

const WIDTH = 180
const HEIGHT = 64

export function ClassNodeView({ id, data, selected }: NodeProps<ClassNode>) {
  const style = data.style
  const paths = useMemo(() => roughRect(WIDTH, HEIGHT, roughNodeOptions(style, seedFor(id))), [id, style])
  const { strokeStyle, strokeWidth } = nodeStyle(style)

  return (
    <div className={`class-node${selected ? ' selected' : ''}`} style={{ width: WIDTH, height: HEIGHT }}>
      <svg width={WIDTH} height={HEIGHT} className="sketch">
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
      <span className="label">{data.label}</span>
      <Handle type="target" position={Position.Bottom} />
      <Handle type="source" position={Position.Top} />
    </div>
  )
}
