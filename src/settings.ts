/**
 * Settings remembered in this browser between sessions. Storage can be unavailable (private
 * windows, blocked site data), so reads fall back to the default and writes are best-effort.
 */

const DEFAULT_NAMESPACE_KEY = 'ontology-sketch.defaultNamespace'

/** The namespace new classes and properties are created in; empty means the ontology IRI. */
export function loadDefaultNamespace(): string {
  try {
    return localStorage.getItem(DEFAULT_NAMESPACE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDefaultNamespace(namespace: string): void {
  try {
    if (namespace.trim()) localStorage.setItem(DEFAULT_NAMESPACE_KEY, namespace)
    else localStorage.removeItem(DEFAULT_NAMESPACE_KEY)
  } catch {
    // Not remembered; the setting still applies for this session.
  }
}
