import rough from 'roughjs'
import type { Options } from 'roughjs/bin/core'

const generator = rough.generator()

/** Stable per-element seed so shapes keep the same wobble between renders. */
export function seedFor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(hash) % 2 ** 31) + 1
}

export type SketchPath = { d: string; stroke: string; strokeWidth: number; fill?: string }

export function roughRect(w: number, h: number, options: Options): SketchPath[] {
  return generator.toPaths(generator.rectangle(2, 2, w - 4, h - 4, options))
}

/**
 * Ellipse touching the middle of each side of a w × h box, where the connection dots sit.
 * curveFitting 1 stops rough.js shrinking or growing the whole ellipse at random, which would
 * leave the dots off the outline; the stroke keeps its hand-drawn wobble.
 */
export function roughEllipse(w: number, h: number, options: Options): SketchPath[] {
  return generator.toPaths(generator.ellipse(w / 2, h / 2, w - 4, h - 4, { ...options, curveFitting: 1 }))
}

export function roughPath(d: string, options: Options): SketchPath[] {
  return generator.toPaths(generator.path(d, options))
}
