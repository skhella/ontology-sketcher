import { createContext } from 'react'
import type { Namespace } from './model'

/** The project's namespaces, so canvas nodes can show the prefix of the one they live in. */
export const NamespacesContext = createContext<Namespace[]>([])
