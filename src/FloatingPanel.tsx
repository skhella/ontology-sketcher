import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clampFrame, moveFrame, parseFrame, resizeFrame, widenFromLeft, type Bounds, type Frame, type FrameMode } from './panelFrame'

type Props = {
  /** Remembers this panel's place and size under its own name, so each panel keeps its own. */
  name: string
  /** 'free': dragged by its title bar and resized from its corner. 'width': stays where the CSS puts it, made wider from its left edge. */
  mode?: FrameMode
  className: string
  'aria-label': string
  children: ReactNode
}

const storageKey = (name: string) => `ontology-sketch:panel:${name}`

function readStored(name: string): Frame | null {
  try {
    return parseFrame(localStorage.getItem(storageKey(name)))
  } catch {
    return null
  }
}

function store(name: string, frame: Frame | null) {
  try {
    if (frame) localStorage.setItem(storageKey(name), JSON.stringify(frame))
    else localStorage.removeItem(storageKey(name))
  } catch {
    // Private windows can refuse storage; the panel still keeps its place for this visit.
  }
}

/** The canvas the panel floats over, which it has to stay inside. */
function boundsOf(el: HTMLElement): Bounds {
  const parent = (el.offsetParent as HTMLElement | null) ?? document.body
  return { width: parent.clientWidth, height: parent.clientHeight }
}

/** The panel's title bar is its first row; its buttons and fields keep working as before. */
function onTitleBar(panel: HTMLElement, target: EventTarget): boolean {
  if (!(target instanceof Element)) return false
  const bar = target.closest('.export-actions')
  return bar !== null && bar === panel.firstElementChild && !target.closest('button, input, select, textarea, a, label')
}

/** A side panel the user can move and resize, or widen, remembering where they left it. Double-click the title bar to put it back. */
export function FloatingPanel({ name, mode = 'free', className, children, ...rest }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [frame, setFrame] = useState<Frame | null>(() => readStored(name))

  // A smaller window must not leave the panel, or its title bar, out of reach.
  useEffect(() => {
    if (mode !== 'free') return
    const onResize = () => setFrame((f) => (f && ref.current ? clampFrame(f, boundsOf(ref.current)) : f))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mode])

  /** Follows the pointer until it is released, then remembers the result. */
  const track = (e: ReactPointerEvent, next: (dx: number, dy: number, bounds: Bounds) => Frame) => {
    const el = ref.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    const bounds = boundsOf(el)
    const x0 = e.clientX
    const y0 = e.clientY
    let last: Frame | null = null
    const onMove = (ev: PointerEvent) => {
      last = next(ev.clientX - x0, ev.clientY - y0, bounds)
      setFrame(last)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('panel-dragging')
      if (last) store(name, last)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.classList.add('panel-dragging')
  }

  /** Where the panel is now, measured if it has never been moved. */
  const current = (el: HTMLElement): Frame => frame ?? { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth }

  const startMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (mode !== 'free' || !onTitleBar(e.currentTarget, e.target)) return
    const start = current(e.currentTarget)
    track(e, (dx, dy, bounds) => moveFrame(start, dx, dy, bounds))
  }

  const startResize = (e: ReactPointerEvent) => {
    const el = ref.current
    if (!el) return
    if (mode === 'width') {
      const startWidth = el.offsetWidth
      // Leave the canvas's left margin free, as the CSS does.
      const maxWidth = el.offsetLeft + el.offsetWidth - 12
      track(e, (dx) => ({ x: 0, y: 0, width: widenFromLeft(startWidth, dx, maxWidth) }))
    } else {
      const start = { ...current(el), height: frame?.height ?? el.offsetHeight }
      track(e, (dx, dy, bounds) => resizeFrame(start, dx, dy, bounds))
    }
  }

  const reset = (e: ReactMouseEvent<HTMLElement>) => {
    if (!onTitleBar(e.currentTarget, e.target)) return
    setFrame(null)
    store(name, null)
  }

  let style: CSSProperties | undefined
  if (frame && mode === 'width') style = { width: frame.width }
  else if (frame)
    style = {
      left: frame.x,
      top: frame.y,
      right: 'auto',
      bottom: 'auto',
      width: frame.width,
      height: frame.height,
      maxHeight: frame.height === undefined ? `calc(100% - ${frame.y + 12}px)` : 'none',
    }

  return (
    <aside
      ref={ref}
      className={`${className} floating-panel${mode === 'free' ? ' movable' : ''}`}
      style={style}
      onPointerDown={startMove}
      onDoubleClick={reset}
      {...rest}
    >
      {/* A widened panel scrolls inside, so its edge to drag stays put while the content scrolls. */}
      {mode === 'width' ? <div className="panel-body">{children}</div> : children}
      <div
        className={mode === 'width' ? 'panel-grip-left' : 'panel-grip'}
        onPointerDown={startResize}
        onDoubleClick={() => {
          setFrame(null)
          store(name, null)
        }}
        title={mode === 'width' ? 'Drag to make wider. Double-click to reset.' : 'Drag to resize. Double-click the title bar to put the panel back.'}
        aria-hidden="true"
      />
    </aside>
  )
}
