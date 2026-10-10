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
import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { describeImport, importExcalidraw } from './excalidraw'
import { importedOntologyIri, sampleOntology, type ClassNode, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { hasConstraints, toShaclTurtle } from './shacl'
import { Inspector } from './inspector/Inspector'
import { classesNotOn, loadCanvas, mergePages, placeClass, removePage, saveCanvas, workspaceFrom, type Workspace } from './pages'
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
  // The canvas above is the active page; other pages wait in the workspace, see pages.ts.
  const [initial] = useState(() => workspaceFrom('Page 1', sampleOntology.nodes, sampleOntology.edges))
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace)
  const [pageId, setPageId] = useState(initial.pageId)
  const [exportPages, setExportPages] = useState<string[] | null>(null)
  // The exported files: the OWL ontology, and the SHACL shapes when any class has constraints.
  const [exported, setExported] = useState<{ ontology: string; shapes: string | null } | null>(null)
  const [showShapes, setShowShapes] = useState(false)
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
      if (nodes.length > 0 && !window.confirm(`Replace this page with ${file.name}?`)) return
      setNodes(result.nodes)
      setEdges(result.edges.map((e) => markerFor(withDefaultHandles(e))))
      setIri((current) => importedOntologyIri(current, file.name))
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

  const updateNode = (id: string, patch: Partial<ClassNode['data']>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))

  const updateEdge = (id: string, patch: Partial<NonNullable<RelationEdge['data']>>) =>
    setEdges((es) => es.map((e) => (e.id === id && e.data ? markerFor({ ...e, data: { ...e.data, ...patch } }) : e)))

  const straighten = () => setEdges((es) => es.map((e) => (e.selected && e.data ? { ...e, data: { ...e.data, bend: undefined } } : e)))

  /** The workspace with the canvas's latest edits written back into it. */
  const saved = () => saveCanvas(workspace, pageId, nodes, edges)

  const show = (ws: Workspace, id: string, fit: boolean) => {
    const canvas = loadCanvas(ws, id)
    setWorkspace(ws)
    setPageId(id)
    setNodes(canvas.nodes)
    setEdges(canvas.edges.map((e) => markerFor(withDefaultHandles(e))))
    if (fit) requestAnimationFrame(() => flow?.fitView({ padding: 0.2 }))
  }

  const openPage = (id: string) => {
    if (id !== pageId) show(saved(), id, true)
  }

  const addPage = () => {
    const name = window.prompt('Page name', `Page ${workspace.pages.length + 1}`)
    if (!name) return
    const id = crypto.randomUUID()
    const ws = saved()
    show({ ...ws, pages: [...ws.pages, { id, name, nodes: [], edges: [] }] }, id, false)
  }

  const renamePage = (id: string) => {
    const page = workspace.pages.find((p) => p.id === id)
    const name = window.prompt('Page name', page?.name)
    if (name) setWorkspace((ws) => ({ ...ws, pages: ws.pages.map((p) => (p.id === id ? { ...p, name } : p)) }))
  }

  const deletePage = (id: string) => {
    const page = workspace.pages.find((p) => p.id === id)
    if (workspace.pages.length < 2 || !page) return
    if (!window.confirm(`Delete page "${page.name}"? Classes that only appear on this page are deleted too.`)) return
    const ws = removePage(saved(), id)
    show(ws, id === pageId ? ws.pages[0].id : pageId, id === pageId)
  }

  // Classes from other pages that can be placed here; placing shares the class, it does not copy it.
  const placeable = useMemo(() => classesNotOn(saveCanvas(workspace, pageId, nodes, edges), pageId), [workspace, pageId, nodes, edges])

  const placeExisting = (event: ChangeEvent<HTMLSelectElement>) => {
    const classId = event.target.value
    if (!classId) return
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const at = flow && rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 120, y: 120 }
    // Step down past classes already sitting there, so placements don't stack on top of each other.
    while (nodes.some((n) => Math.abs(n.position.x - at.x) < 40 && Math.abs(n.position.y - at.y) < 40)) at.y += 100
    show(placeClass(saved(), pageId, classId, at), pageId, false)
  }

  const exportTurtle = async (pageIds: string[]) => {
    setExportPages(null)
    const ontology = mergePages(saved(), pageIds, iri)
    setShowShapes(false)
    setExported({ ontology: await toTurtle(ontology), shapes: hasConstraints(ontology) ? await toShaclTurtle(ontology) : null })
  }

  // With one page there is nothing to choose; otherwise ask which pages go into the file.
  const startExport = () =>
    workspace.pages.length === 1 ? exportTurtle([pageId]) : setExportPages(workspace.pages.map((p) => p.id))

  const toggleExportPage = (id: string) =>
    setExportPages((ids) => (ids?.includes(id) ? ids.filter((i) => i !== id) : [...(ids ?? []), id]))

  const shown = exported && (showShapes && exported.shapes ? exported.shapes : exported.ontology)
  const download = () => {
    if (!shown) return
    const url = URL.createObjectURL(new Blob([shown], { type: 'text/turtle' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: showShapes ? 'shapes.ttl' : 'ontology.ttl' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <strong>ontology-sketch</strong>
        <label>
          Ontology IRI{' '}
          <input value={iri} onChange={(e) => setIri(e.target.value)} size={32} title="Namespace of the whole ontology; a selected class or edge shows its own IRI in the inspector" />
        </label>
        <button onClick={addClass}>+ Class</button>
        <button onClick={() => fileInput.current?.click()}>Import .excalidraw</button>
        <input ref={fileInput} type="file" accept=".excalidraw,.json,application/json" hidden onChange={importFile} />
        {placeable.length > 0 && (
          <select value="" onChange={placeExisting} aria-label="Place a class from another page">
            <option value="">Place existing class…</option>
            {placeable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <button onClick={startExport}>Export OWL (Turtle)</button>
        <span className="hint">
          Drag between boxes to add subClassOf. Click a class or edge to see and edit its own IRI, definition and annotations on the right. Select an edge and drag its dot to curve it.
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
        {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <Inspector
            base={iri}
            nodes={nodes}
            edges={edges}
            selection={[...selectedNodes, ...selectedEdges]}
            onNodeChange={updateNode}
            onEdgeChange={updateEdge}
          />
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        {exportPages && (
          <div className="export-pages" role="dialog" aria-label="Pages to export">
            <strong>Export which pages?</strong>
            <label>
              <input
                type="checkbox"
                checked={exportPages.length === workspace.pages.length}
                onChange={(e) => setExportPages(e.target.checked ? workspace.pages.map((p) => p.id) : [])}
              />
              All pages
            </label>
            {workspace.pages.map((p) => (
              <label key={p.id} className="indent">
                <input type="checkbox" checked={exportPages.includes(p.id)} onChange={() => toggleExportPage(p.id)} />
                {p.name}
              </label>
            ))}
            <span className="hint">Classes on any chosen page are exported once. Relations drawn only on other pages are left out.</span>
            <div className="export-actions">
              <button disabled={exportPages.length === 0} onClick={() => exportTurtle(exportPages)}>
                Export
              </button>
              <button onClick={() => setExportPages(null)}>Cancel</button>
            </div>
          </div>
        )}
        {exported && (
          <aside className="export">
            {exported.shapes && (
              <div className="export-files segmented" role="tablist" aria-label="Exported files">
                {[false, true].map((shapes) => (
                  <button key={String(shapes)} role="tab" className={shapes === showShapes ? 'active' : undefined} aria-selected={shapes === showShapes} onClick={() => setShowShapes(shapes)}>
                    {shapes ? 'shapes.ttl (SHACL)' : 'ontology.ttl (OWL)'}
                  </button>
                ))}
              </div>
            )}
            <div className="export-actions">
              <button onClick={download}>Download {showShapes ? 'shapes.ttl' : 'ontology.ttl'}</button>
              <button onClick={() => setExported(null)}>Close</button>
            </div>
            <pre>{shown}</pre>
          </aside>
        )}
      </main>
      <nav className="pages" aria-label="Pages">
        {workspace.pages.map((p) => (
          <span key={p.id} className={p.id === pageId ? 'page active' : 'page'}>
            <button onClick={() => openPage(p.id)} onDoubleClick={() => renamePage(p.id)} title="Double-click to rename">
              {p.name}
            </button>
            {workspace.pages.length > 1 && (
              <button className="close" onClick={() => deletePage(p.id)} aria-label={`Delete page ${p.name}`}>
                ×
              </button>
            )}
          </span>
        ))}
        <button className="add" onClick={addPage} aria-label="Add page">
          + Page
        </button>
      </nav>
    </div>
  )
}
