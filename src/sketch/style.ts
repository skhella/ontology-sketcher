import type { Options } from 'roughjs/bin/core'

/**
 * Visual style of a node or edge, modelled on Excalidraw's properties panel.
 * Every field is optional; missing fields fall back to the defaults below.
 * Style is presentation only and never reaches the OWL export.
 */
export type SketchStyle = {
  stroke?: string
  /** Background colour; 'transparent' draws no fill. */
  fill?: string
  fillStyle?: FillStyle
  strokeWidth?: number
  strokeStyle?: StrokeStyle
  /** Excalidraw's "sloppiness": 0 architect, 1 artist, 2 cartoonist. */
  roughness?: number
}

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid'
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

// Excalidraw's quick-pick swatches (open-color shades), same order as its panel.
export const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']
export const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99']
export const FILL_STYLES: FillStyle[] = ['hachure', 'cross-hatch', 'solid']
export const STROKE_WIDTHS = [1, 2, 4]
export const STROKE_STYLES: StrokeStyle[] = ['solid', 'dashed', 'dotted']
export const ROUGHNESS = [0, 1, 2]

export const NODE_DEFAULTS: Required<SketchStyle> = {
  stroke: '#1e1e1e',
  fill: '#a5d8ff',
  fillStyle: 'hachure',
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  roughness: 1.2,
}

/** Edges have no fill; strokeStyle stays unset so the edge kind picks solid or dashed. */
export const EDGE_DEFAULTS = { stroke: '#1e1e1e', strokeWidth: 1.5, roughness: 1 }

export function nodeStyle(style: SketchStyle | undefined): Required<SketchStyle> {
  return { ...NODE_DEFAULTS, ...style }
}

/** rough.js options for a node outline and its background. */
export function roughNodeOptions(style: SketchStyle | undefined, seed: number): Options {
  const s = nodeStyle(style)
  const filled = s.fill !== 'transparent'
  return {
    seed,
    roughness: s.roughness,
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    fill: filled ? s.fill : undefined,
    fillStyle: s.fillStyle,
    hachureGap: 4 + s.strokeWidth * 2,
    fillWeight: s.strokeWidth / 2,
  }
}

/** SVG dash pattern for a stroke style, scaled to the stroke width like Excalidraw does. */
export function dashArray(strokeStyle: StrokeStyle | undefined, strokeWidth: number): string | undefined {
  if (strokeStyle === 'dashed') return `${8 + strokeWidth * 2} ${6 + strokeWidth * 2}`
  if (strokeStyle === 'dotted') return `${1.5} ${4 + strokeWidth * 2}`
  return undefined
}
