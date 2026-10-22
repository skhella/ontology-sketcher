import { useNodes, type ConnectionLineComponentProps } from '@xyflow/react'
import type { ClassNode } from '../model'
import { edgeLine } from './curve'
import { boxOf, snapToClass, toAnchor } from './snap'

/** The line drawn while dragging a new edge; it jumps to the dot it will lock to when over a class. */
export function ConnectionLine({ fromNode, fromHandle, fromX, fromY, fromPosition, toX, toY, toPosition }: ConnectionLineComponentProps<ClassNode>) {
  const nodes = useNodes<ClassNode>()
  const snap = snapToClass(nodes.map(boxOf), { x: toX, y: toY }, fromNode.id)
  const { d } = edgeLine(
    { x: fromX, y: fromY },
    toAnchor(fromHandle.id, fromPosition),
    snap?.point ?? { x: toX, y: toY },
    snap?.side ?? toPosition,
    undefined,
  )
  return <path d={d} fill="none" className="connection-line" />
}
