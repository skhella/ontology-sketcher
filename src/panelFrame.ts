/** Where a panel the user moved or resized sits, in pixels from the canvas's top-left corner. */
export type Frame = { x: number; y: number; width: number; height?: number }

/** How a panel can change: dragged anywhere and resized from its corner, or only made wider from its left edge. */
export type FrameMode = 'free' | 'width'

export type Bounds = { width: number; height: number }

/** Small enough for a narrow window, big enough to keep the title bar's buttons usable. */
export const MIN_WIDTH = 260
export const MIN_HEIGHT = 140

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A stored frame, or null for anything else, so a damaged entry falls back to the panel's own place. */
export function parseFrame(stored: string | null): Frame | null {
  if (!stored) return null
  try {
    const v = JSON.parse(stored)
    if (!v || !finite(v.x) || !finite(v.y) || !finite(v.width)) return null
    if (v.height !== undefined && !finite(v.height)) return null
    return v.height === undefined ? { x: v.x, y: v.y, width: v.width } : { x: v.x, y: v.y, width: v.width, height: v.height }
  } catch {
    return null
  }
}

/** Keeps a panel inside the canvas and at least its minimum size, so its title bar can always be reached. */
export function clampFrame(frame: Frame, bounds: Bounds): Frame {
  const width = Math.max(Math.min(frame.width, bounds.width), Math.min(MIN_WIDTH, bounds.width))
  const x = Math.max(0, Math.min(frame.x, bounds.width - width))
  const height = frame.height === undefined ? undefined : Math.max(Math.min(frame.height, bounds.height), Math.min(MIN_HEIGHT, bounds.height))
  const y = Math.max(0, Math.min(frame.y, bounds.height - (height ?? MIN_HEIGHT)))
  return height === undefined ? { x, y, width } : { x, y, width, height }
}

/** The frame after dragging the title bar by (dx, dy). */
export function moveFrame(start: Frame, dx: number, dy: number, bounds: Bounds): Frame {
  return clampFrame({ ...start, x: start.x + dx, y: start.y + dy }, bounds)
}

/** The frame after dragging the bottom-right corner by (dx, dy); the top-left corner stays put. */
export function resizeFrame(start: Frame, dx: number, dy: number, bounds: Bounds): Frame {
  const width = Math.max(MIN_WIDTH, Math.min(start.width + dx, bounds.width - start.x))
  const height = Math.max(MIN_HEIGHT, Math.min((start.height ?? MIN_HEIGHT) + dy, bounds.height - start.y))
  return { ...start, width, height }
}

/** The width after dragging the left edge by dx, for a panel pinned to the right: dragging left widens it. */
export function widenFromLeft(startWidth: number, dx: number, maxWidth: number): number {
  return Math.max(Math.min(MIN_WIDTH, maxWidth), Math.min(startWidth - dx, maxWidth))
}
