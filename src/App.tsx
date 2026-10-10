import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeMouseHandler,
  type OnConnectEnd,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { describeImport, importExcalidraw } from './excalidraw'
import { sampleOntology, type ClassNode, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { ClassNodeView } from './sketch/ClassNodeView'
import { ConnectionLine } from './sketch/ConnectionLine'
import { RelationEdgeView } from './sketch/RelationEdgeView'
import { boxOf, snapToClass, toFlowPoint } from './sketch/snap'
import { StylePanel } from './sketch/StylePanel'
import { EDGE_DEFAULTS, type SketchStyle } from './sketch/style'

const nodeTypes = { owlClass: ClassNodeView }
const edgeTypes = { relation: RelationEdgeView }

function markerFor(edge: RelationEdge): RelationEdge {
  const closed = edge.data?.kind === 'subClassOf'
  const color = edge.data?.style?.stroke ?? EDGE_DEFAULTS.stroke
  return { ...edge, markerEnd: { type: closed ? MarkerType.ArrowClosed : MarkerType.Arrow, color, width: 18, height: 18 } }
}

/**
 * Edges from the sample or an import name no dots; they keep the original look,
 * leaving the subclass from its top dot into the superclass's bottom dot.
 */
function withDefaultHandles(edge: RelationEdge): RelationEdge {
  return { ...edge, sourceHandle: edge.sourceHandle ?? 'top', targetHandle: edge.targetHandle ?? 'bottom' }
}

/** An edge's style as the panel shows it: without an explicit stroke style, the kind decides. */
function edgeStyle(edge: RelationEdge): SketchStyle {
  return { strokeStyle: edge.data?.kind === 'subClassOf' ? 'solid' : 'dashed', ...edge.data?.style }
}

export default function App() {
  const [iri, setIri] = useState(sampleOntology.iri)
  const [nodes, setNodes, onNodesChange] = useNodesState<ClassNode>(sampleOntology.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationEdge>(
    sampleOntology.edges.map((e) => markerFor(withDefaultHandles(e))),
  )
  const [turtle, setTurtle] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [flow, setFlow] = useState<ReactFlowInstance<ClassNode, RelationEdge> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(markerFor({ ...c, id: crypto.randomUUID(), type: 'relation', data: { kind: 'subClassOf', label: '' } }), eds),
      ),
    [setEdges],
  )

  // Dropping a new edge anywhere on a class (not just on a dot) connects it to that class's nearest dot.
  const onConnectEnd: OnConnectEnd = (_, state) => {
    if (state.isValid || !state.fromNode || !state.pointer || !flow) return
    const { x, y, zoom } = flow.getViewport()
    const snap = snapToClass(nodes.map(boxOf), toFlowPoint(state.pointer, [x, y, zoom]), state.fromNode.id)
    if (!snap) return
    onConnect({ source: state.fromNode.id, sourceHandle: state.fromHandle?.id ?? null, target: snap.nodeId, targetHandle: snap.side })
  }

  const addClass = () => {
    const label = window.prompt('Class name', 'New Class')
    if (!label) return
    setNodes((ns) => [
      ...ns,
      { id: crypto.randomUUID(), type: 'owlClass', position: { x: 120 + ns.length * 20, y: 120 + ns.length * 20 }, data: { label } },
    ])
  }

  const renameClass: NodeMouseHandler<ClassNode> = (_, node) => {
    const label = window.prompt('Class name', node.data.label)
    if (label) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label } } : n)))
  }

  // Double-click an edge: enter a property name to make it an object property, or leave empty for subClassOf.
  const editRelation: EdgeMouseHandler<RelationEdge> = (_, edge) => {
    const label = window.prompt('Object property name (leave empty for subClassOf)', edge.data?.label ?? '')
    if (label === null) return
    const kind = label.trim() ? { kind: 'objectProperty' as const, label } : { kind: 'subClassOf' as const, label: '' }
    setEdges((es) => es.map((e) => (e.id === edge.id ? markerFor({ ...e, data: { ...e.data, ...kind } }) : e)))
  }

  // Replaces the canvas with the classes and arrows found in an .excalidraw file.
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const result = importExcalidraw(await file.text())
      if (nodes.length > 0 && !window.confirm(`Replace the current canvas with ${file.name}?`)) return
      setNodes(result.nodes)
      setEdges(result.edges.map((e) => markerFor(withDefaultHandles(e))))
      setNotice(describeImport(result.summary))
      requestAnimationFrame(() => flow?.fitView({ padding: 0.2 }))
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${(error as Error).message}`)
    }
  }

  const selectedNodes = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)

  // Applies a style change from the panel to everything selected, like Excalidraw.
  const restyle = (patch: SketchStyle) => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, style: { ...n.data.style, ...patch } } } : n)))
    setEdges((es) =>
      es.map((e) => (e.selected && e.data ? markerFor({ ...e, data: { ...e.data, style: { ...e.data.style, ...patch } } }) : e)),
    )
  }

  const straighten = () => setEdges((es) => es.map((e) => (e.selected && e.data ? { ...e, data: { ...e.data, bend: undefined } } : e)))

  const exportTurtle = async () => setTurtle(await toTurtle({ iri, nodes, edges }))

  const download = () => {
    if (!turtle) return
    const url = URL.createObjectURL(new Blob([turtle], { type: 'text/turtle' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'ontology.ttl' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <strong>ontology-sketch</strong>
        <label>
          IRI <input value={iri} onChange={(e) => setIri(e.target.value)} size={32} />
        </label>
        <button onClick={addClass}>+ Class</button>
        <button onClick={() => fileInput.current?.click()}>Import .excalidraw</button>
        <input ref={fileInput} type="file" accept=".excalidraw,.json,application/json" hidden onChange={importFile} />
        <button onClick={exportTurtle}>Export OWL (Turtle)</button>
        <span className="hint">
          Drag between boxes to add subClassOf. Double-click to rename or turn an edge into a property. Select an edge and drag its dot to curve it.
        </span>
      </header>
      <main className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          connectionMode={ConnectionMode.Loose}
          connectionLineComponent={ConnectionLine}
          onNodeDoubleClick={renameClass}
          onEdgeDoubleClick={editRelation}
          zoomOnDoubleClick={false}
          onInit={setFlow}
          fitView
          minZoom={0.05}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} />
          <Controls />
        </ReactFlow>
        {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <StylePanel
            current={selectedNodes.length > 0 ? (selectedNodes[0].data.style ?? {}) : edgeStyle(selectedEdges[0])}
            edgesOnly={selectedNodes.length === 0}
            bentEdges={selectedEdges.filter((e) => e.data?.bend).length}
            onChange={restyle}
            onStraighten={straighten}
          />
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        {turtle && (
          <aside className="export">
            <div className="export-actions">
              <button onClick={download}>Download .ttl</button>
              <button onClick={() => setTurtle(null)}>Close</button>
            </div>
            <pre>{turtle}</pre>
          </aside>
        )}
      </main>
    </div>
  )
}
