import { getBezierPath, useNodes, type ConnectionLineComponentProps } from '@xyflow/react'
import type { ClassNode } from '../model'
import { boxOf, snapToClass } from './snap'

/** The line drawn while dragging a new edge; it jumps to the dot it will lock to when over a class. */
export function ConnectionLine({ fromNode, fromX, fromY, fromPosition, toX, toY, toPosition }: ConnectionLineComponentProps<ClassNode>) {
  const nodes = useNodes<ClassNode>()
  const snap = snapToClass(nodes.map(boxOf), { x: toX, y: toY }, fromNode.id)
  const [d] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: snap?.point.x ?? toX,
    targetY: snap?.point.y ?? toY,
    targetPosition: snap?.side ?? toPosition,
  })
  return <path d={d} fill="none" className="connection-line" />
}
