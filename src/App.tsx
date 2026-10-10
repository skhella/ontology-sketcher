import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useState } from 'react'
import { sampleOntology, type ClassNode, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { ClassNodeView } from './sketch/ClassNodeView'
import { RelationEdgeView } from './sketch/RelationEdgeView'

const nodeTypes = { owlClass: ClassNodeView }
const edgeTypes = { relation: RelationEdgeView }

function markerFor(edge: RelationEdge): RelationEdge {
  const closed = edge.data?.kind === 'subClassOf'
  return { ...edge, markerEnd: { type: closed ? MarkerType.ArrowClosed : MarkerType.Arrow, color: '#1e1e1e', width: 18, height: 18 } }
}

export default function App() {
  const [iri, setIri] = useState(sampleOntology.iri)
  const [nodes, setNodes, onNodesChange] = useNodesState<ClassNode>(sampleOntology.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationEdge>(sampleOntology.edges.map(markerFor))
  const [turtle, setTurtle] = useState<string | null>(null)

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(markerFor({ ...c, id: crypto.randomUUID(), type: 'relation', data: { kind: 'subClassOf', label: '' } }), eds),
      ),
    [setEdges],
  )

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
    if (label) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { label } } : n)))
  }

  // Double-click an edge: enter a property name to make it an object property, or leave empty for subClassOf.
  const editRelation: EdgeMouseHandler<RelationEdge> = (_, edge) => {
    const label = window.prompt('Object property name (leave empty for subClassOf)', edge.data?.label ?? '')
    if (label === null) return
    const data = label.trim() ? { kind: 'objectProperty' as const, label } : { kind: 'subClassOf' as const, label: '' }
    setEdges((es) => es.map((e) => (e.id === edge.id ? markerFor({ ...e, data }) : e)))
  }

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
        <button onClick={exportTurtle}>Export OWL (Turtle)</button>
        <span className="hint">Drag between boxes to add subClassOf. Double-click to rename or turn an edge into a property.</span>
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
          onNodeDoubleClick={renameClass}
          onEdgeDoubleClick={editRelation}
          zoomOnDoubleClick={false}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={20} />
          <Controls />
        </ReactFlow>
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
