import type { InternalNode } from '@xyflow/react'
import type { ClassNode } from './model'
import { boxOf, handlePosition, sidePoint, type Anchor } from './sketch/snap'
import { needsLatinExtended } from './svgExport'

// The browser side of the SVG export: measuring text and embedding the font, which toSvg leaves to its caller.

const FONT_DIR = '/fonts/excalifont/'

/** Text widths in Excalifont, once the font has loaded. */
export async function excalifontMeasure(): Promise<(text: string, fontSize: number) => number> {
  await Promise.all([document.fonts.load('20px Excalifont'), document.fonts.load('20px Excalifont', 'ā')])
  const context = document.createElement('canvas').getContext('2d')!
  return (text, fontSize) => {
    context.font = `${fontSize}px Excalifont, 'Shantell Sans', cursive`
    return context.measureText(text).width
  }
}

/**
 * @font-face rules with Excalifont inlined, so the SVG renders the same without the app. Excalifont is OFL-1.1,
 * which allows embedding it in documents. Only the Latin file goes in unless a label needs Latin Extended letters.
 */
export async function excalifontCss(text: string): Promise<string> {
  const faces = [
    { file: 'Excalifont-Latin.woff2', range: 'U+20-7E, U+A0-FF, U+131, U+152-153, U+2013-2014, U+2018-201E, U+2020, U+2022, U+2026, U+20AC, U+2122, U+2212' },
    ...(needsLatinExtended(text) ? [{ file: 'Excalifont-LatinExt.woff2', range: 'U+100-130, U+132-17E, U+192, U+218-21B' }] : []),
  ]
  const rules = await Promise.all(
    faces.map(async ({ file, range }) => {
      const bytes = new Uint8Array(await (await fetch(FONT_DIR + file)).arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return `@font-face{font-family:'Excalifont';src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');unicode-range:${range}}`
    }),
  )
  return '/* Excalifont by Excalidraw, SIL Open Font License 1.1 */' + rules.join('')
}

/**
 * Where React Flow ends an edge at a dot: the middle of the dot's outer side, as on the canvas.
 * A corner dot reports itself as a top or bottom dot to React Flow, so its edge ends on that side of the dot.
 */
export function handleEndpoint(internal: InternalNode<ClassNode> | undefined, node: ClassNode, side: Anchor) {
  const handle = internal?.internals.handleBounds?.source?.find((h) => h.id === side)
  const at = internal?.internals.positionAbsolute ?? node.position
  if (!handle) return sidePoint(boxOf({ ...node, position: at }), side)
  return sidePoint({ id: node.id, x: at.x + handle.x, y: at.y + handle.y, width: handle.width, height: handle.height }, handlePosition(side))
}
