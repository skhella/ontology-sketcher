// File pickers for the Import, Open and Compare entries.
//
// iPhone and iPad Safari turn each entry of an <input accept="..."> into a system file type and grey out every file
// whose type isn't one of them. Extensions iOS has no type for (.ttl, .nt, .owl, .excalidraw) match nothing, so
// those files can't be picked at all. On iOS the pickers therefore take any file, and the app checks the name
// after a file is picked instead. Elsewhere the accept list keeps the desktop file dialog filtered.

export interface FileKind {
  /** What the file is, used in the message when a file of another kind is picked, e.g. "a Turtle file". */
  name: string
  /** Lower-case extensions with the dot, e.g. ['.ttl', '.owl']. */
  extensions: string[]
  /** MIME types added to the accept list for browsers that filter by type. */
  types: string[]
}

export const ONTOLOGY_FILE: FileKind = { name: 'an ontology in Turtle', extensions: ['.ttl', '.nt', '.owl'], types: ['text/turtle'] }
export const SHAPES_FILE: FileKind = { name: 'a SHACL shapes file in Turtle', extensions: ['.ttl'], types: ['text/turtle'] }
export const DRAWING_FILE: FileKind = { name: 'an Excalidraw drawing', extensions: ['.excalidraw', '.json'], types: ['application/json'] }
export const PROJECT_FILE: FileKind = { name: 'a project file', extensions: ['.json'], types: ['application/json'] }

interface NavigatorLike {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}

/** True on iPhone, iPod and iPad, including iPads that report themselves as a Mac. */
export function isIOS(nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1
}

/** The accept attribute for a file input: none on iOS (see above), the extensions and MIME types elsewhere. */
export function acceptFor(kind: FileKind, ios = isIOS()): string | undefined {
  return ios ? undefined : [...kind.extensions, ...kind.types].join(',')
}

/** Undefined when the file name has one of the kind's extensions, otherwise a message saying what was expected. */
export function wrongFileKind(fileName: string, kind: FileKind): string | undefined {
  const lower = fileName.toLowerCase()
  if (kind.extensions.some((ext) => lower.endsWith(ext))) return undefined
  return `${fileName} is not ${kind.name} (${kind.extensions.join(', ')}).`
}
