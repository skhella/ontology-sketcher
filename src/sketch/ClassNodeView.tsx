import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useMemo } from 'react'
import type { ClassNode } from '../model'
import { roughRect, seedFor } from './rough'

const WIDTH = 180
const HEIGHT = 64

export function ClassNodeView({ id, data, selected }: NodeProps<ClassNode>) {
  const paths = useMemo(
    () =>
      roughRect(WIDTH, HEIGHT, {
        seed: seedFor(id),
        roughness: 1.2,
        stroke: '#1e1e1e',
        strokeWidth: 1.5,
        fill: '#a5d8ff',
        fillStyle: 'hachure',
        hachureGap: 6,
      }),
    [id],
  )

  return (
    <div className={`class-node${selected ? ' selected' : ''}`} style={{ width: WIDTH, height: HEIGHT }}>
      <svg width={WIDTH} height={HEIGHT} className="sketch">
        {paths.map((p, i) => (
          <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? 'none'} />
        ))}
      </svg>
      <span className="label">{data.label}</span>
      <Handle type="target" position={Position.Bottom} />
      <Handle type="source" position={Position.Top} />
    </div>
  )
}
