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
  type FinalConnectionState,
  type HandleType,
  type OnConnectEnd,
  type OnReconnect,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { describeImport, importExcalidraw } from './excalidraw'
import { planImport, saveLayout } from './layout'
import { describeOwlImport, importOwl } from './owlImport'
import { describeShapesImport, importShapes } from './shapesImport'
import logoSvg from '../docs/logo-light.svg?raw'
import { importedOntologyIri, sampleOntology, type ClassNode, type NodeKind, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { toCypherScript } from './neo4j'
import { hasConstraints, toShaclTurtle } from './shacl'
import { defaultEdge, isSkosEdge, NODE_KIND_NAMES, NODE_KIND_STYLES } from './skos'
import { Inspector } from './inspector/Inspector'
import { SampleData } from './SampleData'
import { classesNotOn, loadCanvas, mergePages, placeClass, removePage, saveCanvas, workspaceFrom, type Workspace } from './pages'
import { ClassNodeView } from './sketch/ClassNodeView'
import { ConnectionLine } from './sketch/ConnectionLine'
import { RelationEdgeView } from './sketch/RelationEdgeView'
import { boxOf, snapToClass, toFlowPoint } from './sketch/snap'
import { StylePanel } from './sketch/StylePanel'
import { EDGE_DEFAULTS, type SketchStyle } from './sketch/style'
import { useTheme } from './theme'
import { toSvg } from './svgExport'
import { excalifontCss, excalifontMeasure, handleEndpoint } from './svgBrowser'

const nodeTypes = { owlClass: ClassNodeView }
const edgeTypes = { relation: RelationEdgeView }

type ExportFormat = 'owl' | 'cypher'
// How the SVG image of the page is drawn; it follows the canvas's light colours unless dark is picked.
type SvgLook = { dark: boolean; background: boolean }
type ExportFile = { name: string; label: string; type: string; text: string }

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
  // What the open export shows: the OWL ontology plus SHACL shapes when any class has constraints,
  // or the Cypher script for Neo4j. Several files get tabs.
  const [exportFormat, setExportFormat] = useState<ExportFormat>('owl')
  const [exported, setExported] = useState<ExportFile[] | null>(null)
  const [shownFile, setShownFile] = useState(0)
  const [svgLook, setSvgLook] = useState<SvgLook | null>(null)
  // The sample data panel, and the classes whose instances in it break a constraint (outlined on the canvas).
  const [sampleOpen, setSampleOpen] = useState(false)
  const [problemClasses, setProblemClasses] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [flow, setFlow] = useState<ReactFlowInstance<ClassNode, RelationEdge> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const drawingInput = useRef<HTMLInputElement>(null)
  const shapesInput = useRef<HTMLInputElement>(null)
  const [theme, toggleTheme] = useTheme()

  // Between classes a new edge is subClassOf; from a concept it is skos:broader, or skos:topConceptOf into a scheme.
  const onConnect = useCallback(
    (c: Connection) => {
      const dataOf = (id: string) => nodes.find((n) => n.id === id)?.data
      const data = defaultEdge(dataOf(c.source), dataOf(c.target))
      setEdges((eds) => addEdge(markerFor({ ...c, id: crypto.randomUUID(), type: 'relation', data }), eds))
    },
    [nodes, setEdges],
  )

  // The class and dot under the pointer where a dragged edge end was let go, or null over empty canvas.
  const snapAtDrop = (state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || !state.pointer || !flow) return null
    const { x, y, zoom } = flow.getViewport()
    return snapToClass(nodes.map(boxOf), toFlowPoint(state.pointer, [x, y, zoom]), state.fromNode.id)
  }

  // Dropping a new edge anywhere on a class (not just on a dot) connects it to that class's nearest dot.
  // React Flow also calls this when an existing edge's end is dropped; onReconnectEnd handles that case.
  const reconnecting = useRef(false)
  const onConnectEnd: OnConnectEnd = (_, state) => {
    const snap = reconnecting.current ? null : snapAtDrop(state)
    if (!snap || !state.fromNode) return
    onConnect({ source: state.fromNode.id, sourceHandle: state.fromHandle?.id ?? null, target: snap.nodeId, targetHandle: snap.side })
  }

  // Dragging an edge's end onto another class moves only that end. The relation keeps its id, so its
  // IRI, label, characteristics and axioms stay; on other pages it follows to the new class too.
  const onReconnect: OnReconnect<RelationEdge> = useCallback(
    (edge, c) =>
      setEdges((es) =>
        es.map((e) => (e.id === edge.id ? { ...e, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle } : e)),
      ),
    [setEdges],
  )

  // Like a new edge, a moved end dropped anywhere on a class locks to its nearest dot; on empty canvas the edge stays as it was.
  // `fixed` is the end that did not move.
  const onReconnectEnd = (_: globalThis.MouseEvent | TouchEvent, edge: RelationEdge, fixed: HandleType, state: FinalConnectionState) => {
    reconnecting.current = false
    const snap = snapAtDrop(state)
    if (!snap) return
    onReconnect(
      edge,
      fixed === 'source'
        ? { source: edge.source, sourceHandle: edge.sourceHandle ?? null, target: snap.nodeId, targetHandle: snap.side }
        : { source: snap.nodeId, sourceHandle: snap.side, target: edge.target, targetHandle: edge.targetHandle ?? null },
    )
  }

  // Adds a class, or with a kind a SKOS concept or scheme, which starts in its own colours.
  const addNode = (kind?: NodeKind) => {
    const name = NODE_KIND_NAMES[kind ?? 'class']
    const label = window.prompt(`${name} name`, `New ${name}`)
    if (!label) return
    const data = kind ? { label, kind, style: NODE_KIND_STYLES[kind] } : { label }
    setNodes((ns) => [
      ...ns,
      { id: crypto.randomUUID(), type: 'owlClass', position: { x: 120 + ns.length * 20, y: 120 + ns.length * 20 }, data },
    ])
  }

  const renameClass: NodeMouseHandler<ClassNode> = (_, node) => {
    const label = window.prompt(`${NODE_KIND_NAMES[node.data.kind ?? 'class']} name`, node.data.label)
    if (label) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label } } : n)))
  }

  // Double-click an edge: enter a property name to make it an object property, or leave empty for subClassOf.
  // SKOS edges have no name to type; their kind is picked in the inspector.
  const editRelation: EdgeMouseHandler<RelationEdge> = (_, edge) => {
    if (isSkosEdge(edge.data?.kind)) return
    const label = window.prompt('Object property name (leave empty for subClassOf)', edge.data?.label ?? '')
    if (label === null) return
    const kind = label.trim() ? { kind: 'objectProperty' as const, label } : { kind: 'subClassOf' as const, label: '' }
    setEdges((es) => es.map((e) => (e.id === edge.id ? markerFor({ ...e, data: { ...e.data, ...kind } }) : e)))
  }

  // Replaces the canvas with the classes and arrows found in an .excalidraw file, or in an OWL ontology in Turtle.
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      if (/\.(ttl|nt|owl|rdf)$/i.test(file.name) || !text.trimStart().startsWith('{')) {
        const result = importOwl(text)
        if (nodes.length > 0 && !window.confirm(`Replace this page with ${file.name}? Classes already on it keep their place.`)) return
        // The first planned page replaces this one; a saved layout or a large ontology adds more.
        const { pages } = planImport(result, { iri, workspace: saved(), pageId })
        let ws = saveCanvas(saved(), pageId, pages[0].nodes, pages[0].edges)
        if (pages[0].name) ws = { ...ws, pages: ws.pages.map((p) => (p.id === pageId ? { ...p, name: pages[0].name! } : p)) }
        for (const page of pages.slice(1)) {
          const id = crypto.randomUUID()
          ws = saveCanvas({ ...ws, pages: [...ws.pages, { id, name: page.name ?? `Page ${ws.pages.length + 1}`, nodes: [], edges: [] }] }, id, page.nodes, page.edges)
        }
        setIri(result.iri)
        show(ws, pageId, true)
        const added = pages.length > 1 ? ` Added ${pages.length - 1} ${pages.length === 2 ? 'page' : 'pages'}.` : ''
        setNotice(describeOwlImport(result.summary) + added)
        return
      } else {
        const result = importExcalidraw(text)
        if (nodes.length > 0 && !window.confirm(`Replace this page with ${file.name}?`)) return
        setNodes(result.nodes)
        setEdges(result.edges.map((e) => markerFor(withDefaultHandles(e))))
        setIri((current) => importedOntologyIri(current, file.name))
        setNotice(describeImport(result.summary))
      }
      requestAnimationFrame(() => flow?.fitView({ padding: 0.2 }))
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${(error as Error).message}`)
    }
  }

  // The Import and Export menus close once an entry is picked; a click elsewhere closes them too (see the effect below).
  const closeMenu = (event: MouseEvent<HTMLDetailsElement>) => {
    if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open')
  }
  useEffect(() => {
    const closeOthers = (event: PointerEvent) => {
      for (const menu of document.querySelectorAll('details.menu[open]')) if (!menu.contains(event.target as Node)) menu.removeAttribute('open')
    }
    document.addEventListener('pointerdown', closeOthers)
    return () => document.removeEventListener('pointerdown', closeOthers)
  }, [])

  // Reads a SHACL shapes file onto the classes on this page, replacing their constraints, see shapesImport.ts.
  const importShapesFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const result = await importShapes(await file.text(), iri, nodes, edges)
      const replaced = nodes.filter((n) => result.classes.has(n.id) && (n.data.constraints?.length || n.data.extraShapes || n.data.constraintsClosed))
      if (replaced.length > 0 && !window.confirm(`Replace the constraints on ${replaced.map((n) => n.data.label).join(', ')} with those in ${file.name}?`)) return
      setNodes((ns) =>
        ns.map((n) => {
          const imported = result.classes.get(n.id)
          return imported
            ? { ...n, data: { ...n.data, constraints: imported.constraints, constraintsClosed: imported.closed, extraShapes: imported.extra } }
            : n
        }),
      )
      setNotice(describeShapesImport(result))
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${(error as Error).message}`)
    }
  }

  const selectedNodes = nodes.filter((n) => n.selected)
  // Classes whose sample instances break a constraint get an outline, set only on the nodes React Flow draws so it never reaches saved pages.
  const shownNodes = useMemo(
    () => (problemClasses.length === 0 ? nodes : nodes.map((n) => (problemClasses.includes(n.id) ? { ...n, className: 'has-problems' } : n))),
    [nodes, problemClasses],
  )
  const selectClass = (id: string) => {
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))
    setNodes((ns) => ns.map((n) => (!!n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)))
  }
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

  const runExport = async (format: ExportFormat, pageIds: string[]) => {
    setExportPages(null)
    setSvgLook(null)
    const ws = saved()
    const ontology = mergePages(ws, pageIds, iri)
    // The OWL file carries the pages' layout so importing it draws them again; Neo4j gets plain OWL.
    const turtle = await toTurtle(ontology, format === 'owl' ? saveLayout(ws, pageIds, iri) : undefined)
    const shapes = hasConstraints(ontology) ? await toShaclTurtle(ontology) : null
    setShownFile(0)
    setExported(
      format === 'cypher'
        ? [{ name: 'ontology.cypher', label: 'ontology.cypher (Neo4j)', type: 'text/plain', text: toCypherScript({ iri: ontology.iri, ontology: turtle, shapes }) }]
        : [
            { name: 'ontology.ttl', label: 'ontology.ttl (OWL)', type: 'text/turtle', text: turtle },
            ...(shapes ? [{ name: 'shapes.ttl', label: 'shapes.ttl (SHACL)', type: 'text/turtle', text: shapes }] : []),
          ],
    )
  }

  // With one page there is nothing to choose; otherwise ask which pages go into the file.
  const startExport = (format: ExportFormat) => {
    setExportFormat(format)
    if (workspace.pages.length === 1) runExport(format, [pageId])
    else setExportPages(workspace.pages.map((p) => p.id))
  }

  // The SVG image shows this page as drawn, so there are no pages to choose.
  const exportSvg = async (look: SvgLook) => {
    setExportPages(null)
    setSvgLook(look)
    const text = nodes.map((n) => n.data.label).join(' ') + edges.map((e) => e.data?.label ?? '').join(' ')
    const [measure, fontCss] = await Promise.all([excalifontMeasure(), excalifontCss(text)])
    const svg = toSvg(nodes, edges, {
      measure,
      fontCss,
      endpoint: (node, side) => handleEndpoint(flow?.getInternalNode(node.id), node, side),
      ...look,
    })
    const page = workspace.pages.find((p) => p.id === pageId)?.name ?? 'page'
    const name = `${page.trim().replace(/[^\w.-]+/g, '-') || 'page'}.svg`
    setShownFile(0)
    setExported([{ name, label: name, type: 'image/svg+xml', text: svg }])
  }

  const toggleExportPage = (id: string) =>
    setExportPages((ids) => (ids?.includes(id) ? ids.filter((i) => i !== id) : [...(ids ?? []), id]))

  const shown = exported?.[shownFile]
  const download = () => {
    if (!shown) return
    const url = URL.createObjectURL(new Blob([shown.text], { type: shown.type }))
    const a = Object.assign(document.createElement('a'), { href: url, download: shown.name })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <span className="brand-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg }} />
          <strong>Ontology Sketcher</strong>
        </span>
        <label>
          Ontology IRI{' '}
          <input value={iri} onChange={(e) => setIri(e.target.value)} size={32} title="Namespace of the whole ontology; a selected class or edge shows its own IRI in the inspector" />
        </label>
        <button onClick={() => addNode()}>+ Class</button>
        <button onClick={() => addNode('concept')} title="A SKOS concept: a term in a thesaurus or code list, exported as an individual">
          + Concept
        </button>
        <button onClick={() => addNode('scheme')} title="A SKOS concept scheme: the thesaurus or code list concepts belong to">
          + Scheme
        </button>
        <details className="menu" onClick={closeMenu}>
          <summary>Import</summary>
          <div className="menu-items">
            <button onClick={() => fileInput.current?.click()} title="Load the classes and properties of an ontology in Turtle (.ttl) onto this page">
              Ontology (Turtle)
            </button>
            <button onClick={() => drawingInput.current?.click()} title="Replace this page with the labelled shapes and arrows of an .excalidraw drawing">
              Excalidraw drawing
            </button>
            <button onClick={() => shapesInput.current?.click()} title="Read a SHACL shapes file (Turtle) into the constraints of the classes on this page">
              SHACL shapes (Turtle)
            </button>
          </div>
        </details>
        <input ref={fileInput} type="file" accept=".ttl,.nt,.owl,text/turtle" hidden onChange={importFile} />
        <input ref={drawingInput} type="file" accept=".excalidraw,.json,application/json" hidden onChange={importFile} />
        <input ref={shapesInput} type="file" accept=".ttl,text/turtle" hidden onChange={importShapesFile} />
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
        <details className="menu" onClick={closeMenu}>
          <summary>Export</summary>
          <div className="menu-items">
            <button onClick={() => startExport('owl')} title="ontology.ttl, plus shapes.ttl when classes have SHACL constraints">
              OWL and SHACL (Turtle)
            </button>
            <button onClick={() => startExport('cypher')} title="A Cypher script that loads the ontology (and shapes) into Neo4j with the neosemantics (n10s) plugin">
              Neo4j script (Cypher)
            </button>
            <button onClick={() => exportSvg({ dark: false, background: true })} title="This page as a drawing, for papers and slides">
              Image of this page (SVG)
            </button>
          </div>
        </details>
        <button onClick={() => setSampleOpen(true)} title="Check example instances against the classes' SHACL constraints">
          Check sample data
        </button>
        <button onClick={toggleTheme} aria-pressed={theme === 'dark'} title="Switch between light and dark mode">
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
        <span className="hint">
          Drag between boxes to add subClassOf, or broader between concepts. Click a class or edge to see and edit its own IRI, definition and annotations on the right. Select an edge and drag its middle dot to curve it, or drag either end onto another class to move it.
        </span>
      </header>
      <main className="canvas">
        <ReactFlow
          nodes={shownNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          onReconnectStart={() => {
            reconnecting.current = true
          }}
          onReconnectEnd={onReconnectEnd}
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
              <button disabled={exportPages.length === 0} onClick={() => runExport(exportFormat, exportPages)}>
                Export
              </button>
              <button onClick={() => setExportPages(null)}>Cancel</button>
            </div>
          </div>
        )}
        {sampleOpen && (
          <SampleData
            ontology={() => mergePages(saved(), workspace.pages.map((p) => p.id), iri)}
            nodes={nodes}
            onProblemClasses={setProblemClasses}
            onSelectClass={selectClass}
            onClose={() => setSampleOpen(false)}
          />
        )}
        {exported && (
          <aside className="export">
            {exported.length > 1 && (
              <div className="export-files segmented" role="tablist" aria-label="Exported files">
                {exported.map((file, i) => (
                  <button key={file.name} role="tab" className={i === shownFile ? 'active' : undefined} aria-selected={i === shownFile} onClick={() => setShownFile(i)}>
                    {file.label}
                  </button>
                ))}
              </div>
            )}
            <div className="export-actions">
              <button onClick={download}>Download {shown?.name}</button>
              <button onClick={() => setExported(null)}>Close</button>
            </div>
            {svgLook && shown ? (
              <>
                <div className="export-options">
                  <label>
                    <input type="checkbox" checked={svgLook.background} onChange={(e) => exportSvg({ ...svgLook, background: e.target.checked })} />
                    Background
                  </label>
                  <label>
                    <input type="checkbox" checked={svgLook.dark} onChange={(e) => exportSvg({ ...svgLook, dark: e.target.checked })} />
                    Dark mode
                  </label>
                </div>
                <div className="export-image">
                  <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown.text)}`} alt={`Preview of ${shown.name}`} />
                </div>
              </>
            ) : (
              <pre>{shown?.text}</pre>
            )}
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
