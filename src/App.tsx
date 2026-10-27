import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeMouseHandler,
  type FinalConnectionState,
  type HandleType,
  type OnConnectEnd,
  type OnReconnect,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { describeImport, importExcalidraw } from './excalidraw'
import { hiddenOn, withoutHidden } from './hidden'
import { record, redo, startHistory, undo, type History } from './history'
import { planImport } from './layout'
import { newQuestion, runQuestions, type CompetencyQuestion, type QuestionResult } from './questions'
import { QuestionsPanel } from './QuestionsPanel'
import { InferredSuperclasses } from './inspector/InferredSuperclasses'
import { inferredArrows, inferSuperclasses, type Reasoning } from './reason'
import { entityIri } from './owl'
import { shortName } from './vocab'
import { diffOntologies, type OntologyDiff } from './diff'
import { canvasDiff, canvasTargets, DIFF_COLORS, GHOST, type CanvasTarget } from './diffCanvas'
import { DiffPanel } from './DiffPanel'
import { exportFiles, exportFilesPerPage, pageFileStems, type ExportFile, type ExportFormat } from './exportFiles'
import { keptStatementsOf } from './keptStatements'
import { describeOwlImport, importOwl, type OwlImportResult } from './owlImport'
import { importIntoProject, LIBRARY, type LibraryEntry } from './library'
import { applyShapes, describeShapesImport, importShapesToWorkspace, keptShapesTargeting, withShapes } from './shapesImport'
import logoSvg from '../docs/logo-light.svg?raw'
import { importedOntologyIri, localName, type ClassNode, type KeptProperty, type KeptStatement, type Namespace, type NodeKind, type RelationEdge } from './model'
import { NamespacesContext } from './namespaceContext'
import { PageLinksContext, type PageLinks } from './pageLinksContext'
import { mergeNamespaces, renameNamespace } from './namespaces'
import { NamespacesMenu } from './NamespacesMenu'
import { defaultEdge, isSkosEdge, NODE_KIND_NAMES, NODE_KIND_STYLES } from './skos'
import { ClassPages } from './inspector/ClassPages'
import { Inspector } from './inspector/Inspector'
import { PropertyHierarchy } from './PropertyHierarchyPanel'
import type { Finding } from './lint'
import { LintPanel } from './LintPanel'
import { lintProject, lintTargets, type LintTarget } from './lintProject'
import { propertyEntries } from './propertyHierarchy'
import { SampleData } from './SampleData'
import { addDetailPage, classesNotOn, linkPage, loadCanvas, mergePages, placeClass, removePage, saveCanvas, type Workspace } from './pages'
import { defaultProjectName, emptyProject, loadAutosave, nameFromFileName, projectFileName, projectFromJson, projectToJson, sampleProject, writeAutosave, PROJECT_EXTENSION, type Project } from './project'
import { ClassNodeView } from './sketch/ClassNodeView'
import { ConnectionLine } from './sketch/ConnectionLine'
import { RelationEdgeView } from './sketch/RelationEdgeView'
import { boxOf, snapToClass, toFlowPoint } from './sketch/snap'
import { StylePanel } from './sketch/StylePanel'
import { EDGE_DEFAULTS, type SketchStyle } from './sketch/style'
import { useTheme } from './theme'
import { useCanvasHelp } from './canvasHelp'
import { dotEndpoint, sized, toSvg } from './svgExport'
import { excalifontCss, excalifontMeasure, handleEndpoint } from './svgBrowser'
import { zip } from './zip'

const nodeTypes = { owlClass: ClassNodeView }
const edgeTypes = { relation: RelationEdgeView }
// Shift-click adds a class or arrow to the selection, or takes it out again; Ctrl and Cmd do the same.
const MULTI_SELECT_KEYS = ['Shift', 'Meta', 'Control']

// Like Excalidraw: the select tool drags out a selection box, the hand tool pans with the left button.
type Tool = 'select' | 'hand'
const TOOLS: { tool: Tool; key: string; label: string; icon: string }[] = [
  { tool: 'select', key: 'v', label: 'Select', icon: 'M5 3l14 8-6 1.5L10 19z' },
  { tool: 'hand', key: 'h', label: 'Hand (pan)', icon: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-5-2.7L4.6 14a1.6 1.6 0 0 1 2.6-1.8L8 13' },
]

// How the SVG image of the page is drawn; it follows the canvas's light colours unless dark is picked.
type SvgLook = { dark: boolean; background: boolean }

// Excalidraw's violet, for superclasses the reasoner adds; the inspector uses --inferred to match.
const INFERRED = '#7048e8'

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

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  // The project autosaved in this browser comes back on reload; a first visit opens the pizza sample, see project.ts.
  const [initial] = useState(() => loadAutosave() ?? sampleProject())
  const [initialCanvas] = useState(() => loadCanvas(initial.workspace, initial.pageId))
  // The project's own name, asked for on the first save and used as the project file's name.
  const [projectName, setProjectName] = useState(initial.name ?? '')
  const [iri, setIri] = useState(initial.iri)
  const [namespaces, setNamespaces] = useState<Namespace[]>(initial.namespaces ?? [])
  // Properties from imported ontologies the canvas doesn't draw; the export writes them back, see KeptProperty.
  const [kept, setKept] = useState<KeptProperty[]>(initial.kept ?? [])
  // Other statements from imported ontologies the canvas doesn't show, see KeptStatement.
  const [keptStatements, setKeptStatements] = useState<KeptStatement[]>(initial.keptStatements ?? [])
  const [nodes, setNodes, onNodesChange] = useNodesState<ClassNode>(initialCanvas.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationEdge>(
    initialCanvas.edges.map((e) => markerFor(withDefaultHandles(e))),
  )
  // The canvas above is the active page; other pages wait in the workspace, see pages.ts.
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace)
  const [pageId, setPageId] = useState(initial.pageId)
  const [exportPages, setExportPages] = useState<string[] | null>(null)
  // Whether the chosen pages go into one file or a file each; SVG images are always one per page.
  const [exportSplit, setExportSplit] = useState(false)
  // What the open export shows: the OWL ontology plus SHACL shapes when any class has constraints,
  // or the Cypher script for Neo4j, or images. Several files get tabs and can be downloaded together as a zip.
  const [exportFormat, setExportFormat] = useState<ExportFormat | 'svg'>('owl')
  const [exported, setExported] = useState<ExportFile[] | null>(null)
  const [zipName, setZipName] = useState('ontology.zip')
  const [shownFile, setShownFile] = useState(0)
  const [svgLook, setSvgLook] = useState<SvgLook | null>(null)
  const [svgPages, setSvgPages] = useState<string[]>([])
  // The sample data panel, and the classes whose instances in it break a constraint (outlined on the canvas).
  const [sampleOpen, setSampleOpen] = useState(false)
  // Competency questions (see questions.ts), kept with the project, and their answers from the last run.
  const [questions, setQuestions] = useState<CompetencyQuestion[]>(initial.questions ?? [])
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [answers, setAnswers] = useState<{ results: Map<string, QuestionResult>; running?: boolean; error?: string }>({ results: new Map() })
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // The ontology check (see lint.ts): its findings, undefined until the first run, or why it could not run.
  const [lintOpen, setLintOpen] = useState(false)
  const [lint, setLint] = useState<{ findings?: Finding[]; error?: string }>({})
  const [problemClasses, setProblemClasses] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  // Whether hidden classes and arrows are drawn (faded) on the canvas and in SVG images; see hidden.ts.
  const [showHidden, setShowHidden] = useState(false)
  // Comparing with an earlier file (see diff.ts): the file, the Turtle file imported this session to offer, and the result.
  const [compareOpen, setCompareOpen] = useState(false)
  const [baseline, setBaseline] = useState<{ name: string; text: string } | null>(null)
  const [lastImport, setLastImport] = useState<{ name: string; text: string } | null>(null)
  const [comparison, setComparison] = useState<{ diff?: OntologyDiff; error?: string }>({})
  // Sizes React Flow measured for ghost classes: they are not in `nodes`, so their measurements are kept here.
  const [ghostSizes, setGhostSizes] = useState<Record<string, { width: number; height: number }>>({})
  const [flow, setFlow] = useState<ReactFlowInstance<ClassNode, RelationEdge> | null>(null)
  // Inferred superclasses (see reason.ts): drawn as arrows when asked, and listed for the selected class.
  const [showInferred, setShowInferred] = useState(false)
  const [reasoning, setReasoning] = useState<Reasoning | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const drawingInput = useRef<HTMLInputElement>(null)
  const shapesInput = useRef<HTMLInputElement>(null)
  const compareInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const [theme, toggleTheme] = useTheme()
  const [helpShown, toggleHelp] = useCanvasHelp()

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
  /**
   * Puts an imported ontology on page `target` of `ws` and shows it; a saved layout or a large ontology adds pages after it.
   * Returns how many pages it fills.
   */
  const placeImport = (result: OwlImportResult, statements: KeptStatement[], start: Workspace, target: string) => {
    const { pages } = planImport(result, { iri, workspace: start, pageId: target })
    let ws = saveCanvas(start, target, pages[0].nodes, pages[0].edges)
    if (pages[0].name) ws = { ...ws, pages: ws.pages.map((p) => (p.id === target ? { ...p, name: pages[0].name! } : p)) }
    if (pages[0].classId) ws = linkPage(ws, target, pages[0].classId)
    for (const page of pages.slice(1)) {
      const id = crypto.randomUUID()
      ws = saveCanvas({ ...ws, pages: [...ws.pages, { id, name: page.name ?? `Page ${ws.pages.length + 1}`, nodes: [], edges: [] }] }, id, page.nodes, page.edges)
      if (page.classId) ws = linkPage(ws, id, page.classId)
    }
    setIri(result.iri)
    setNamespaces((current) => mergeNamespaces(current, result.namespaces))
    setKept((current) => [...current.filter((p) => !result.kept.some((k) => k.iri === p.iri)), ...result.kept])
    setKeptStatements((current) => [...current.filter((s) => !statements.some((t) => t.ntriples === s.ntriples)), ...statements])
    show(ws, target, true)
    return pages.length
  }

  // A standard ontology from the library, downloaded and put on a new page of its own; the project keeps its IRI.
  const importFromLibrary = async (entry: LibraryEntry) => {
    setLibraryOpen(false)
    setNotice(`Downloading ${entry.name}…`)
    let text: string
    try {
      const response = await fetch(entry.url, { headers: { Accept: 'text/turtle' } })
      if (!response.ok) throw new Error(`the server answered ${response.status}`)
      text = await response.text()
    } catch (error) {
      setNotice(`Could not download ${entry.name} (${(error as Error).message}). Download ${entry.url} yourself and use Import > Ontology (Turtle).`)
      return
    }
    try {
      const { result, statements } = await importIntoProject(text, { iri, namespaces }, entry.id)
      const id = crypto.randomUUID()
      const start = saved()
      const pages = placeImport(result, statements, { ...start, pages: [...start.pages, { id, name: entry.name, nodes: [], edges: [] }] }, id)
      const where = pages > 1 ? `${pages} new pages` : 'a new page'
      setNotice(`${entry.name} is on ${where}. ${describeOwlImport(result.summary)}`)
    } catch (error) {
      setNotice(`Could not import ${entry.name}: ${(error as Error).message}`)
    }
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      if (/\.(ttl|nt|owl|rdf)$/i.test(file.name) || !text.trimStart().startsWith('{')) {
        const result = importOwl(text)
        const statements = await keptStatementsOf(text, { iri: result.iri, nodes: result.nodes, edges: result.edges, kept: result.kept })
        if (nodes.length > 0 && !window.confirm(`Replace this page with ${file.name}? Classes already on it keep their place.`)) return
        const pages = placeImport(result, statements, saved(), pageId)
        const added = pages > 1 ? ` Added ${pages - 1} ${pages === 2 ? 'page' : 'pages'}.` : ''
        const other = statements.length > 0 ? ` Kept ${statements.length} other ${statements.length === 1 ? 'statement' : 'statements'} the canvas can't show; the export writes them back.` : ''
        setNotice(describeOwlImport(result.summary) + added + other)
        setLastImport({ name: file.name, text })
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

  // Reads a SHACL shapes file onto the classes on every page, replacing their constraints, see shapesImport.ts.
  const importShapesFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const ws = saved()
      const result = await importShapesToWorkspace(await file.text(), iri, ws)
      const replaced = Object.entries(ws.store.classes).filter(([id, c]) => result.classes.has(id) && (c.constraints?.length || c.extraShapes || c.constraintsClosed))
      if (replaced.length > 0 && !window.confirm(`Replace the constraints on ${replaced.map(([, c]) => c.label).join(', ')} with those in ${file.name}?`)) return
      // Classes on other pages take the shapes in the shared store; those on this page on the canvas too, which saveCanvas writes back.
      setWorkspace(applyShapes(ws, result))
      setNodes((ns) =>
        ns.map((n) => {
          const imported = result.classes.get(n.id)
          return imported ? { ...n, data: withShapes(n.data, imported) } : n
        }),
      )
      setNotice(describeShapesImport(result))
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${(error as Error).message}`)
    }
  }

  const selectedNodes = nodes.filter((n) => n.selected)
  const hidden = useMemo(() => hiddenOn(nodes, edges), [nodes, edges])
  const hiddenCount = nodes.filter((n) => n.data.hidden).length + edges.filter((e) => e.data?.hidden).length
  // While comparing, the export of every page is compared with the earlier file shortly after edits settle; a run
  // overtaken by a newer one is dropped.
  useEffect(() => {
    if (!compareOpen || !baseline) return
    let current = true
    const timer = setTimeout(() => {
      const ws = saveCanvas(workspace, pageId, nodes, edges)
      exportFiles('owl', ws, ws.pages.map((p) => p.id), { iri, namespaces, kept, keptStatements })
        .then(([owl]) => current && setComparison({ diff: diffOntologies(baseline.text, owl.text, iri) }))
        .catch((e: unknown) => current && setComparison({ error: `Could not compare with ${baseline.name}: ${e instanceof Error ? e.message : String(e)}` }))
    }, 400)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [compareOpen, baseline, workspace, pageId, nodes, edges, iri, namespaces, kept, keptStatements])
  const onCanvas = useMemo(
    () => (compareOpen && comparison.diff ? canvasDiff(comparison.diff, saveCanvas(workspace, pageId, nodes, edges), pageId, iri, { nodes, edges }) : undefined),
    [compareOpen, comparison, workspace, pageId, nodes, edges, iri],
  )
  const compareTargets = useMemo(() => (compareOpen ? canvasTargets(saveCanvas(workspace, pageId, nodes, edges), iri, pageId) : new Map<string, CanvasTarget>()), [compareOpen, workspace, pageId, nodes, edges, iri])
  const compareWith = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setComparison({})
    setBaseline({ name: file.name, text: await file.text() })
  }
  /** Opens the page a changed class or arrow is on, selects it and brings it into view. */
  const showChanged = ({ pageId: page, nodeId, edgeId }: CanvasTarget) => {
    if (page !== pageId) show(saved(), page, false)
    setNodes((ns) => ns.map((n) => (!!n.selected !== (n.id === nodeId) ? { ...n, selected: n.id === nodeId } : n)))
    setEdges((es) => es.map((e) => (!!e.selected !== (e.id === edgeId) ? { ...e, selected: e.id === edgeId } : e)))
    const edge = edgeId ? workspace.store.relations[edgeId] : undefined
    const ids = nodeId ? [nodeId] : edge ? [edge.source, edge.target] : []
    // Two frames, so a page just opened has drawn its classes before the view moves to them.
    requestAnimationFrame(() => requestAnimationFrame(() => flow?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.6, maxZoom: 1.2, duration: 300 })))
  }

  // Classes whose sample instances break a constraint get an outline, set only on the nodes React Flow draws so it never reaches saved pages.
  // Hidden classes and arrows are left out the same way, unless hidden elements are shown.
  // While comparing, changed classes and arrows take the colour of their change, and removed ones are drawn as ghosts.
  const shownNodes = useMemo(() => {
    const shown =
      problemClasses.length === 0 && (showHidden || hidden.nodes.size === 0) && !onCanvas
        ? nodes
        : nodes.map((n) => {
            const problem = problemClasses.includes(n.id)
            const out = !showHidden && hidden.nodes.has(n.id)
            const change = onCanvas?.nodes.get(n.id)
            return problem || out || change
              ? {
                  ...n,
                  ...(change && { className: `diff-${change}`, data: { ...n.data, style: { ...n.data.style, stroke: DIFF_COLORS[change] } } }),
                  ...(problem && { className: 'has-problems' }),
                  ...(out && { hidden: true }),
                }
              : n
          })
    return onCanvas ? [...shown, ...onCanvas.ghostNodes.map((g) => (ghostSizes[g.id] ? { ...g, measured: ghostSizes[g.id] } : g))] : shown
  }, [nodes, problemClasses, showHidden, hidden, onCanvas, ghostSizes])
  const onShownNodesChange = useCallback(
    (changes: NodeChange<ClassNode>[]) => {
      const sizes = changes.flatMap((c) => (c.type === 'dimensions' && c.id.startsWith(GHOST) && c.dimensions ? [[c.id, c.dimensions] as const] : []))
      if (sizes.length > 0) setGhostSizes((current) => ({ ...current, ...Object.fromEntries(sizes) }))
      onNodesChange(changes.filter((c) => !('id' in c) || !c.id.startsWith(GHOST)))
    },
    [onNodesChange],
  )
  const shownEdges = useMemo(() => {
    const shown =
      (showHidden || hidden.edges.size === 0) && !onCanvas
        ? edges
        : edges.map((e) => {
            const out = !showHidden && hidden.edges.has(e.id)
            const change = onCanvas?.edges.get(e.id)
            const marked = change && e.data ? markerFor({ ...e, className: `diff-${change}`, data: { ...e.data, style: { ...e.data.style, stroke: DIFF_COLORS[change] } } }) : e
            return out ? { ...marked, hidden: true } : marked
          })
    return onCanvas ? [...shown, ...onCanvas.ghostEdges.map(markerFor)] : shown
  }, [edges, showHidden, hidden, onCanvas])
  const selectClass = (id: string) => {
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))
    setNodes((ns) => ns.map((n) => (!!n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)))
  }
  const selectedEdges = edges.filter((e) => e.selected)

  // The reasoner runs on the export of every page shortly after edits settle, while inferred arrows are shown or one class is selected.
  const selectedClass = selectedNodes.length === 1 && selectedEdges.length === 0 && !selectedNodes[0].data.kind ? selectedNodes[0] : undefined
  const reasonNow = showInferred || !!selectedClass
  useEffect(() => {
    if (!reasonNow) return
    let current = true
    const timer = setTimeout(() => {
      const ws = saveCanvas(workspace, pageId, nodes, edges)
      exportFiles('owl', ws, ws.pages.map((p) => p.id), { iri, namespaces, kept, keptStatements })
        .then(([owl]) => current && setReasoning(inferSuperclasses(owl.text, iri)))
        // An export that does not parse leaves nothing to reason about; the export itself reports the problem.
        .catch(() => current && setReasoning({ inferred: new Map(), stated: new Map() }))
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [reasonNow, workspace, pageId, nodes, edges, iri, namespaces, kept, keptStatements])
  const classIri = useMemo(() => new Map(nodes.map((n) => [n.id, entityIri(iri, n.data, localName(n.data.label))])), [nodes, iri])
  const inferredEdges = useMemo((): RelationEdge[] => {
    if (!showInferred || !reasoning) return []
    const onPage = new Map([...classIri].map(([id, i]) => [i, id]))
    return nodes.flatMap((n) =>
      inferredArrows(reasoning, classIri.get(n.id)!)
        .filter((i) => onPage.has(i.sup))
        .map((i) =>
          markerFor({
            id: `inferred:${n.id}:${onPage.get(i.sup)}`,
            type: 'relation',
            source: n.id,
            target: onPage.get(i.sup)!,
            sourceHandle: 'top',
            targetHandle: 'bottom',
            data: { kind: 'subClassOf', label: '', style: { stroke: INFERRED, strokeStyle: 'dashed' } },
            className: 'inferred',
            selectable: false,
            focusable: false,
          }),
        ),
    )
  }, [showInferred, reasoning, nodes, classIri])
  const canvasEdges = useMemo(() => (inferredEdges.length > 0 ? [...shownEdges, ...inferredEdges] : shownEdges), [shownEdges, inferredEdges])

  // A selection box takes every arrow touching a class inside it; like Excalidraw, keep only the arrows with both ends inside.
  const keepEdgesInsideSelection = () => {
    const inside = new Set((flow?.getNodes() ?? nodes).filter((n) => n.selected).map((n) => n.id))
    setEdges((es) => es.map((e) => (e.selected && !(inside.has(e.source) && inside.has(e.target)) ? { ...e, selected: false } : e)))
  }

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

  // Editing a namespace's IRI moves the classes and properties in it along, on every page.
  const changeNamespaces = (next: Namespace[], renamed?: { from: string; to: string }) => {
    setNamespaces(next)
    if (!renamed || renamed.from === renamed.to) return
    const move = <T extends { data?: { namespace?: string } }>(items: T[]): T[] =>
      items.map((i) => (i.data?.namespace === renamed.from ? { ...i, data: { ...i.data, namespace: renamed.to } } : i))
    setWorkspace((ws) => renameNamespace(ws, renamed.from, renamed.to))
    setNodes(move)
    setEdges(move)
  }

  // Hides or unhides what is selected, on this page only. Hidden things that are not drawn are unselected,
  // so a key press can't delete what can't be seen.
  const setSelectionHidden = (hide: boolean) => {
    const drop = hide && !showHidden
    const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    const mark = <T extends ClassNode | RelationEdge>(item: T): T => ({
      ...item,
      ...(drop && { selected: false }),
      data: { ...item.data!, hidden: hide || undefined },
    })
    setNodes((ns) => ns.map((n) => (n.selected ? mark(n) : n)))
    // An arrow of a class that is hidden goes too, without being marked: it comes back with its class.
    setEdges((es) => es.map((e) => (e.selected && e.data ? mark(e) : drop && (ids.has(e.source) || ids.has(e.target)) ? { ...e, selected: false } : e)))
  }

  const toggleShowHidden = () => {
    if (showHidden) {
      setNodes((ns) => ns.map((n) => (n.selected && hidden.nodes.has(n.id) ? { ...n, selected: false } : n)))
      setEdges((es) => es.map((e) => (e.selected && hidden.edges.has(e.id) ? { ...e, selected: false } : e)))
    }
    setShowHidden(!showHidden)
  }

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

  // Classes on this page with a detail page elsewhere get a tab that opens it; the ref keeps `open` current without changing the context.
  const openRef = useRef(openPage)
  useEffect(() => {
    openRef.current = openPage
  })
  const pageLinks = useMemo<PageLinks>(
    () => ({
      detail: new Map(workspace.pages.filter((p) => p.classId && p.id !== pageId).map((p) => [p.classId!, { id: p.id, name: p.name }])),
      open: (id) => openRef.current(id),
    }),
    [workspace.pages, pageId],
  )

  const linkClassPage = (id: string, classId: string | undefined) => setWorkspace(linkPage(saved(), id, classId))

  const addClassPage = (classId: string) => {
    const id = crypto.randomUUID()
    show(addDetailPage(saved(), classId, id), id, true)
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

  // Imported rules kept on other classes, on any page, that also target the class in the inspector.
  const keptElsewhere = useMemo(() => {
    const selected = nodes.filter((n) => n.selected)
    if (selected.length !== 1 || edges.some((e) => e.selected)) return []
    return keptShapesTargeting(iri, saveCanvas(workspace, pageId, nodes, edges).store.classes, selected[0].id)
  }, [iri, workspace, pageId, nodes, edges])

  // Every property of the project for the property hierarchy, worked out only while it is open.
  const properties = useMemo(
    () => (propertiesOpen ? propertyEntries(saveCanvas(workspace, pageId, nodes, edges), { iri, kept, keptStatements }) : new Map()),
    [propertiesOpen, workspace, pageId, nodes, edges, iri, kept, keptStatements],
  )

  // The check reruns shortly after edits settle while it is open; a run that finishes after a newer one started is dropped.
  useEffect(() => {
    if (!lintOpen) return
    let current = true
    const timer = setTimeout(() => {
      lintProject(saveCanvas(workspace, pageId, nodes, edges), { iri, namespaces, kept, keptStatements })
        .then((findings) => current && setLint({ findings }))
        .catch((e: unknown) => current && setLint({ error: `The check could not read the ontology: ${e instanceof Error ? e.message : String(e)}` }))
    }, 400)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [lintOpen, workspace, pageId, nodes, edges, iri, namespaces, kept, keptStatements])
  const lintWhere = useMemo(() => (lintOpen ? lintTargets(saveCanvas(workspace, pageId, nodes, edges), iri, pageId) : new Map()), [lintOpen, workspace, pageId, nodes, edges, iri])

  /** Opens the page a finding's class or arrow is on, selects it and brings it into view. */
  const showTarget = ({ pageId: page, nodeId, edgeId }: LintTarget) => {
    if (page !== pageId) show(saved(), page, false)
    setNodes((ns) => ns.map((n) => (!!n.selected !== (n.id === nodeId) ? { ...n, selected: n.id === nodeId } : n)))
    setEdges((es) => es.map((e) => (!!e.selected !== (e.id === edgeId) ? { ...e, selected: e.id === edgeId } : e)))
    const edge = edgeId ? workspace.store.relations[edgeId] : undefined
    const ids = nodeId ? [nodeId] : edge ? [edge.source, edge.target] : []
    // Two frames, so a page just opened has drawn its classes before the view moves to them.
    requestAnimationFrame(() => requestAnimationFrame(() => flow?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.6, maxZoom: 1.2, duration: 300 })))
  }

  const placeExisting = (event: ChangeEvent<HTMLSelectElement>) => {
    const classId = event.target.value
    if (!classId) return
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const at = flow && rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 120, y: 120 }
    // Step down past classes already sitting there, so placements don't stack on top of each other.
    while (nodes.some((n) => Math.abs(n.position.x - at.x) < 40 && Math.abs(n.position.y - at.y) < 40)) at.y += 100
    show(placeClass(saved(), pageId, classId, at), pageId, false)
  }

  // The chosen pages merged into one file, or with `split` a file (or OWL and SHACL pair) per page, see exportFiles.ts.
  const runExport = async (format: ExportFormat, pageIds: string[], split: boolean) => {
    setExportPages(null)
    setSvgLook(null)
    const ws = saved()
    const context = { iri, namespaces, kept, keptStatements }
    const files = split ? await exportFilesPerPage(format, ws, pageIds, context) : await exportFiles(format, ws, pageIds, context)
    setShownFile(0)
    setZipName(split ? 'ontology-pages.zip' : 'ontology.zip')
    setExported(files)
  }

  // With one page there is nothing to choose; otherwise ask which pages go into the file.
  const startExport = (format: ExportFormat) => {
    setExportFormat(format)
    setExportSplit(false)
    if (workspace.pages.length === 1) runExport(format, [pageId], false)
    else setExportPages(workspace.pages.map((p) => p.id))
  }

  // Images of several pages at once: ask which.
  const startSvgExport = () => {
    setExportFormat('svg')
    setExportPages(workspace.pages.map((p) => p.id))
  }

  // An SVG image per page, as drawn. The page on screen is drawn from the canvas itself; other pages
  // from their placements, sized as the canvas would draw them. `keepTab` keeps the shown image when the look changes.
  const exportSvg = async (look: SvgLook, pageIds: string[] = [pageId], keepTab = false) => {
    setExportPages(null)
    setSvgLook(look)
    setSvgPages(pageIds)
    const ws = saved()
    const stems = pageFileStems(ws.pages)
    // Hidden classes and arrows are drawn only while they are shown on the canvas.
    const drawn = (canvas: { nodes: ClassNode[]; edges: RelationEdge[] }) => (showHidden ? canvas : withoutHidden(canvas.nodes, canvas.edges))
    const canvases = ws.pages
      .filter((p) => pageIds.includes(p.id))
      .map((page) => ({ page, ...drawn(page.id === pageId ? { nodes, edges } : loadCanvas(ws, page.id)) }))
    const text = canvases.flatMap((c) => [...c.nodes.map((n) => n.data.label), ...c.edges.map((e) => e.data?.label ?? '')]).join(' ')
    const [measure, fontCss] = await Promise.all([excalifontMeasure(), excalifontCss(text)])
    const files = canvases.map(({ page, nodes, edges }): ExportFile => {
      const onScreen = page.id === pageId
      const svg = toSvg(onScreen ? nodes : nodes.map((n) => sized(n, measure)), edges, {
        measure,
        fontCss,
        endpoint: onScreen ? (node, side) => handleEndpoint(flow?.getInternalNode(node.id), node, side) : dotEndpoint,
        ...look,
      })
      const name = `${stems.get(page.id)}.svg`
      return { name, label: canvases.length > 1 ? page.name : name, type: 'image/svg+xml', text: svg }
    })
    setShownFile((i) => (keepTab && i < files.length ? i : 0))
    setZipName('page-images.zip')
    setExported(files)
  }

  const runChosenExport = (pageIds: string[]) => {
    if (exportFormat === 'svg') exportSvg({ dark: false, background: true }, pageIds)
    else runExport(exportFormat, pageIds, exportSplit)
  }

  const toggleExportPage = (id: string) =>
    setExportPages((ids) => (ids?.includes(id) ? ids.filter((i) => i !== id) : [...(ids ?? []), id]))

  const shown = exported?.[shownFile]
  const downloadShown = () => {
    if (shown) download(shown.name, new Blob([shown.text], { type: shown.type }))
  }
  const downloadAll = () => {
    if (exported) download(zipName, new Blob([zip(exported.map(({ name, text }) => ({ name, text })))], { type: 'application/zip' }))
  }

  const project = (): Project => ({ ...(projectName && { name: projectName }), iri, namespaces, kept, keptStatements, ...(questions.length > 0 && { questions }), workspace: saved(), pageId })

  // Autosave: shortly after the last change, and when the tab is closed, the whole project is kept in this browser.
  const storageWarned = useRef(false)
  useEffect(() => {
    const autosave = () => {
      const autosaved = { ...(projectName && { name: projectName }), iri, namespaces, kept, keptStatements, ...(questions.length > 0 && { questions }), workspace: saveCanvas(workspace, pageId, nodes, edges), pageId }
      if (writeAutosave(autosaved) || storageWarned.current) return
      storageWarned.current = true
      setNotice('This browser is not keeping your work (storage is full or blocked). Use Project, Save project to keep a copy.')
    }
    const timer = setTimeout(autosave, 500)
    window.addEventListener('pagehide', autosave)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', autosave)
    }
  }, [projectName, iri, namespaces, kept, keptStatements, questions, workspace, pageId, nodes, edges])

  // Undo history: the project is noted once changes settle, and never while a mouse button is held,
  // so dragging one class, a whole selection or an edge's curve is one step, see history.ts.
  const history = useRef<History>(startHistory(initial))
  const [steps, setSteps] = useState({ undo: 0, redo: 0 })
  const latest = useRef<Project>(initial)
  const pointerDown = useRef(false)
  const setHistory = (next: History) => {
    history.current = next
    setSteps({ undo: next.past.length, redo: next.future.length })
  }
  const noteChange = () => {
    if (!pointerDown.current) setHistory(record(history.current, latest.current))
  }
  useEffect(() => {
    latest.current = { iri, namespaces, kept, keptStatements, workspace: saveCanvas(workspace, pageId, nodes, edges), pageId }
    const timer = setTimeout(noteChange, 300)
    return () => clearTimeout(timer)
  }, [iri, namespaces, kept, keptStatements, workspace, pageId, nodes, edges])
  useEffect(() => {
    const down = () => {
      pointerDown.current = true
    }
    const up = () => {
      pointerDown.current = false
      noteChange()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])

  const restore = (next: Project) => {
    setIri(next.iri)
    setNamespaces(next.namespaces ?? [])
    setKept(next.kept ?? [])
    setKeptStatements(next.keptStatements ?? [])
    show(next.workspace, next.pageId, next.pageId !== pageId)
  }
  // An edit made just before is noted first, so undo always takes it back.
  const stepBack = () => {
    const next = undo(record(history.current, latest.current))
    if (!next) return
    setHistory(next)
    restore(next.present)
  }
  const stepForward = () => {
    const next = redo(record(history.current, latest.current))
    if (!next) return
    setHistory(next)
    restore(next.present)
  }

  // Asks for the project's name, offering the one it has; null when the user cancels.
  const askProjectName = (): string | null => {
    const answer = window.prompt('Project name (also the name of the saved file):', projectName || defaultProjectName(iri))
    if (answer === null) return null
    const name = answer.trim()
    setProjectName(name)
    return name
  }
  const renameProject = () => {
    askProjectName()
  }
  // The first save of an unnamed project asks for a name; cancelling it doesn't save.
  const saveProject = () => {
    const name = projectName || askProjectName()
    if (name === null) return
    download(projectFileName(iri, name), new Blob([projectToJson({ ...project(), ...(name && { name }) })], { type: 'application/json' }))
  }

  const [tool, setTool] = useState<Tool>('select')
  const panning = tool === 'hand'
  // V picks the select tool and H the hand, unless a text field has the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      const picked = TOOLS.find((t) => t.key === event.key.toLowerCase())
      if (picked) setTool(picked.tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ctrl+S (Cmd+S on a Mac) saves the project file instead of the browser saving the web page.
  // Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes; in a text field they stay the field's own undo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        saveProject()
        return
      }
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (key === 'z' || key === 'y') {
        event.preventDefault()
        if (key === 'y' || event.shiftKey) stepForward()
        else stepBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const loadProject = (next: Project) => {
    setProjectName(next.name ?? '')
    setExported(null)
    setExportPages(null)
    setSampleOpen(false)
    setProblemClasses([])
    setIri(next.iri)
    setNamespaces(next.namespaces ?? [])
    setKept(next.kept ?? [])
    setKeptStatements(next.keptStatements ?? [])
    setQuestions(next.questions ?? [])
    setAnswers({ results: new Map() })
    show(next.workspace, next.pageId, true)
  }

  // Every question runs over the export of every page, as the ontology stands now.
  const runAllQuestions = async () => {
    setAnswers((a) => ({ ...a, running: true, error: undefined }))
    try {
      const ws = saved()
      const [owl] = await exportFiles('owl', ws, ws.pages.map((p) => p.id), { iri, namespaces, kept, keptStatements })
      setAnswers({ results: await runQuestions(questions, owl.text, iri, namespaces) })
    } catch (error) {
      setAnswers({ results: new Map(), error: `Could not run the questions: ${(error as Error).message}` })
    }
  }
  // An edited question loses its old answer, so a pass never shows for a query that has not run.
  const changeQuestions = (next: CompetencyQuestion[]) => {
    const before = new Map(questions.map((q) => [q.id, q]))
    setQuestions(next)
    setAnswers((a) => ({ ...a, results: new Map([...a.results].filter(([id]) => next.some((q) => q.id === id && before.get(id) === q))) }))
  }
  const addQuestion = () => {
    const pick = nodes.find((n) => n.selected && !n.data.kind) ?? nodes.find((n) => !n.data.kind)
    changeQuestions([...questions, newQuestion(pick && localName(pick.data.label))])
  }

  const hasClasses = () => Object.keys(saved().store.classes).length > 0
  const replaceWarning = 'The project open now is replaced; use Save project first to keep a copy.'

  const newProject = () => {
    if (hasClasses() && !window.confirm(`Start a new, empty project? ${replaceWarning}`)) return
    loadProject(emptyProject())
  }

  const openProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const next = projectFromJson(await file.text())
      if (hasClasses() && !window.confirm(`Open ${file.name}? ${replaceWarning}`)) return
      // Files saved before projects had names are named after the file.
      loadProject({ ...next, name: next.name ?? nameFromFileName(file.name) })
      setNotice(`Opened ${file.name}.`)
    } catch (error) {
      setNotice(`Could not open ${file.name}: ${(error as Error).message}.`)
    }
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <span className="brand-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg }} />
          <strong>Ontology Sketcher</strong>
        </span>
        <details className="menu" onClick={closeMenu}>
          <summary title={projectName || undefined}>Project</summary>
          <div className="menu-items">
            <span className="menu-note menu-name">{projectName || 'Unnamed project'}</span>
            <button onClick={renameProject} title="Give the project a name; Save project uses it as the file name">
              Rename project…
            </button>
            <button onClick={newProject} title="Start over with one empty page">
              New project
            </button>
            <button onClick={() => projectInput.current?.click()} title={`Open a project file (${PROJECT_EXTENSION}) saved earlier`}>
              Open project…
            </button>
            <button onClick={saveProject} title="Download every page, class, axiom, constraint and position as one project file (Ctrl+S)">
              Save project
            </button>
            <span className="menu-note">Your work is also kept in this browser as you go.</span>
          </div>
        </details>
        <input ref={projectInput} type="file" accept=".json,application/json" hidden onChange={openProject} />
        <button onClick={stepBack} disabled={steps.undo === 0} title="Undo the last change, on any page (Ctrl+Z, Cmd+Z on a Mac)">
          Undo
        </button>
        <button onClick={stepForward} disabled={steps.redo === 0} title="Redo what was undone (Ctrl+Shift+Z or Ctrl+Y)">
          Redo
        </button>
        <label>
          Ontology IRI{' '}
          <input value={iri} onChange={(e) => setIri(e.target.value)} size={32} title="Namespace of the whole ontology; a selected class or edge shows its own IRI in the inspector" />
        </label>
        <NamespacesMenu namespaces={namespaces} onChange={changeNamespaces} />
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
            <button onClick={() => setLibraryOpen(true)} title="Download a standard ontology such as BFO, PROV-O or OWL-Time onto a new page">
              Standard ontology…
            </button>
          </div>
        </details>
        <input ref={fileInput} type="file" accept=".ttl,.nt,.owl,text/turtle" hidden onChange={importFile} />
        <input ref={drawingInput} type="file" accept=".excalidraw,.json,application/json" hidden onChange={importFile} />
        <input ref={shapesInput} type="file" accept=".ttl,text/turtle" hidden onChange={importShapesFile} />
        <input ref={compareInput} type="file" accept=".ttl,.nt,.owl,text/turtle" hidden onChange={compareWith} />
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
            {workspace.pages.length > 1 && (
              <button onClick={startSvgExport} title="A drawing of each chosen page, downloaded together as a zip">
                Images of several pages (SVG)
              </button>
            )}
          </div>
        </details>
        <button
          onClick={() => setShowInferred((shown) => !shown)}
          aria-pressed={showInferred}
          title="Draw superclasses that follow from the ontology without being stated, as dashed violet arrows; select a class to see why"
        >
          Show inferred
        </button>
        <button
          onClick={() => {
            setPropertiesOpen((open) => !open)
            setLintOpen(false)
          }}
          aria-pressed={propertiesOpen}
          title="Object and data properties as a tree by subPropertyOf, with domain, range and the pages each is on"
        >
          Properties
        </button>
        <button
          onClick={() => {
            setLintOpen((open) => !open)
            setPropertiesOpen(false)
          }}
          aria-pressed={lintOpen}
          title="Look for clashing declarations, subclass cycles, missing labels, domains and ranges, and shapes about missing classes or properties"
        >
          Check ontology
        </button>
        <button onClick={() => setSampleOpen(true)} title="Check example instances against the classes' SHACL constraints">
          Check sample data
        </button>
        <button
          onClick={() => {
            setCompareOpen((open) => !open)
            setPropertiesOpen(false)
          }}
          aria-pressed={compareOpen}
          title="Compare the canvas with an earlier Turtle file and colour what was added, changed or removed"
        >
          Compare
        </button>
        {(hiddenCount > 0 || showHidden) && (
          <button
            onClick={toggleShowHidden}
            aria-pressed={showHidden}
            title="Draw the classes and arrows hidden on this page, faded, or leave them out. SVG images follow this; the other exports always include everything."
          >
            {showHidden ? 'Leave out hidden' : `Show hidden (${hiddenCount})`}
          </button>
        )}
        <button onClick={() => setQuestionsOpen((open) => !open)} aria-pressed={questionsOpen} title="What the ontology should answer, as SPARQL queries you can run against it">
          Questions{questions.length > 0 ? ` (${questions.length})` : ''}
        </button>
        <button onClick={toggleTheme} aria-pressed={theme === 'dark'} title="Switch between light and dark mode">
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
        {helpShown ? (
          <span className="hint">
            Drag between boxes to add subClassOf, or broader between concepts. Click a class or edge to see and edit its own IRI, definition and annotations on the right. Select an edge and drag its middle dot to curve it, or drag either end onto another class to move it. Drag on empty canvas to select several things and move them together; Shift-click adds to the selection. Pan with the hand tool (H), Space+drag or the middle mouse button; V goes back to selecting.
            <button className="help-toggle" onClick={toggleHelp} title="Hide these tips" aria-label="Hide tips">
              ×
            </button>
          </span>
        ) : (
          <button className="help-toggle" onClick={toggleHelp} title="Show tips on drawing and selecting" aria-label="Show tips">
            ?
          </button>
        )}
      </header>
      <main className={panning ? 'canvas hand-tool' : 'canvas'}>
        <NamespacesContext.Provider value={namespaces}>
          <PageLinksContext.Provider value={pageLinks}>
            <ReactFlow
              nodes={shownNodes}
              edges={canvasEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onShownNodesChange}
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
              onNodeDoubleClick={panning ? undefined : renameClass}
              onEdgeDoubleClick={panning ? undefined : editRelation}
              zoomOnDoubleClick={false}
              // With the select tool, dragging on empty canvas draws a selection box; the whole selection then moves together,
              // and panning is the middle mouse button or Space held while dragging. With the hand tool any left drag pans.
              selectionOnDrag={!panning}
              panOnDrag={panning ? true : [1]}
              nodesDraggable={!panning}
              nodesConnectable={!panning}
              edgesReconnectable={!panning}
              elementsSelectable={!panning}
              selectionKeyCode={null}
              multiSelectionKeyCode={MULTI_SELECT_KEYS}
              onSelectionEnd={keepEdgesInsideSelection}
              onInit={setFlow}
              fitView
              minZoom={0.05}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} />
              {/* The select and hand tools sit just above the zoom buttons, in the same size and style. */}
              <Panel position="bottom-left" className="canvas-corner">
                <div className="react-flow__controls tools" role="toolbar" aria-label="Canvas tools">
                  {TOOLS.map((t) => (
                    <ControlButton
                      key={t.tool}
                      className={tool === t.tool ? 'active' : undefined}
                      aria-pressed={tool === t.tool}
                      aria-label={t.label}
                      title={`${t.label} (${t.key.toUpperCase()})`}
                      onClick={() => setTool(t.tool)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={t.icon} />
                      </svg>
                    </ControlButton>
                  ))}
                </div>
                <Controls style={{ position: 'static', margin: 0 }} />
              </Panel>
            </ReactFlow>
          </PageLinksContext.Provider>
        </NamespacesContext.Provider>
        {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <StylePanel
            current={selectedNodes.length > 0 ? (selectedNodes[0].data.style ?? {}) : edgeStyle(selectedEdges[0])}
            edgesOnly={selectedNodes.length === 0}
            bentEdges={selectedEdges.filter((e) => e.data?.bend).length}
            hidden={[...selectedNodes, ...selectedEdges].every((item) => item.data?.hidden)}
            onHide={setSelectionHidden}
            onChange={restyle}
            onStraighten={straighten}
          />
        )}
        {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <Inspector
            base={iri}
            namespaces={namespaces}
            nodes={nodes}
            edges={edges}
            selection={[...selectedNodes, ...selectedEdges]}
            onNodeChange={updateNode}
            onEdgeChange={updateEdge}
            inferred={
              selectedClass && (
                <InferredSuperclasses
                  inferences={reasoning && (reasoning.inferred.get(classIri.get(selectedClass.id) ?? '') ?? [])}
                  labelOf={(i) => nodes.find((n) => classIri.get(n.id) === i)?.data.label ?? Object.values(workspace.store.classes).find((c) => entityIri(iri, c, localName(c.label)) === i)?.label ?? shortName(i)}
                />
              )
            }
            keptElsewhere={keptElsewhere}
            classPages={
              selectedNodes.length === 1 &&
              selectedEdges.length === 0 && (
                <ClassPages
                  classId={selectedNodes[0].id}
                  label={selectedNodes[0].data.label}
                  pages={workspace.pages}
                  pageId={pageId}
                  onOpen={openPage}
                  onLink={linkClassPage}
                  onNewPage={() => addClassPage(selectedNodes[0].id)}
                />
              )
            }
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
            {exportFormat !== 'svg' && (
              <label>
                <input type="checkbox" checked={exportSplit} onChange={(e) => setExportSplit(e.target.checked)} />
                One file per page
              </label>
            )}
            <span className="hint">
              {exportFormat === 'svg'
                ? 'Each chosen page becomes its own image.'
                : exportSplit
                  ? 'Each chosen page becomes its own file, as if it were exported alone: its classes and the relations drawn on it. A class on several pages is in each of their files.'
                  : 'Classes on any chosen page are exported once. Relations drawn only on other pages are left out.'}
            </span>
            <div className="export-actions">
              <button disabled={exportPages.length === 0} onClick={() => runChosenExport(exportPages)}>
                Export
              </button>
              <button onClick={() => setExportPages(null)}>Cancel</button>
            </div>
          </div>
        )}
        {questionsOpen && (
          <QuestionsPanel
            questions={questions}
            results={answers.results}
            running={!!answers.running}
            error={answers.error}
            onChange={changeQuestions}
            onAdd={addQuestion}
            onRun={runAllQuestions}
            onClose={() => setQuestionsOpen(false)}
          />
        )}
        {propertiesOpen && <PropertyHierarchy entries={properties} pageId={pageId} onOpenPage={openPage} onClose={() => setPropertiesOpen(false)} />}
        {lintOpen && <LintPanel findings={lint.findings} error={lint.error} targets={lintWhere} onShow={showTarget} onClose={() => setLintOpen(false)} />}
        {sampleOpen && (
          <SampleData
            ontology={() => ({ ...mergePages(saved(), workspace.pages.map((p) => p.id), iri), kept, keptStatements })}
            nodes={nodes}
            onProblemClasses={setProblemClasses}
            onSelectClass={selectClass}
            onClose={() => setSampleOpen(false)}
          />
        )}
        {libraryOpen && (
          <aside className="property-hierarchy" aria-label="Standard ontologies">
            <div className="export-actions">
              <strong>Standard ontologies</strong>
              <button onClick={() => setLibraryOpen(false)}>Close</button>
            </div>
            <p className="hint">
              Each goes onto a new page with its own IRIs; your ontology keeps its IRI. Your browser downloads it from the publisher, so check its
              licence before you share the result.
            </p>
            <ul className="library-list">
              {LIBRARY.map((entry) => (
                <li key={entry.id}>
                  <button onClick={() => importFromLibrary(entry)} title={entry.url}>
                    {entry.name}
                  </button>
                  <span className="muted">{entry.description}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}
        {compareOpen && (
          <DiffPanel
            baseline={baseline}
            imported={lastImport}
            diff={comparison.diff}
            error={comparison.error}
            targets={compareTargets}
            onChooseFile={() => compareInput.current?.click()}
            onUseImported={() => {
              setComparison({})
              setBaseline(lastImport)
            }}
            onShow={showChanged}
            onClose={() => setCompareOpen(false)}
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
              <button onClick={downloadShown}>Download {shown?.name}</button>
              {exported.length > 1 && <button onClick={downloadAll} title={zipName}>Download all (.zip)</button>}
              <button onClick={() => setExported(null)}>Close</button>
            </div>
            {svgLook && shown ? (
              <>
                <div className="export-options">
                  <label>
                    <input type="checkbox" checked={svgLook.background} onChange={(e) => exportSvg({ ...svgLook, background: e.target.checked }, svgPages, true)} />
                    Background
                  </label>
                  <label>
                    <input type="checkbox" checked={svgLook.dark} onChange={(e) => exportSvg({ ...svgLook, dark: e.target.checked }, svgPages, true)} />
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
          <span key={p.id} className={`page${p.id === pageId ? ' active' : ''}${p.classId ? ' linked' : ''}`}>
            <button
              onClick={() => openPage(p.id)}
              onDoubleClick={() => renamePage(p.id)}
              title={p.classId && workspace.store.classes[p.classId] ? `Detail page of ${workspace.store.classes[p.classId].label}. Double-click to rename` : 'Double-click to rename'}
            >
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
