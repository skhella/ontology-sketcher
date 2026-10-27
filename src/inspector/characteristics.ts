import type { Characteristic } from '../model'

/** The OWL property characteristics, in the order the inspector and the Not on the canvas panel list them. */
export const CHARACTERISTICS: { key: Characteristic; label: string }[] = [
  { key: 'functional', label: 'Functional' },
  { key: 'inverseFunctional', label: 'Inverse functional' },
  { key: 'transitive', label: 'Transitive' },
  { key: 'symmetric', label: 'Symmetric' },
  { key: 'asymmetric', label: 'Asymmetric' },
  { key: 'reflexive', label: 'Reflexive' },
  { key: 'irreflexive', label: 'Irreflexive' },
]
