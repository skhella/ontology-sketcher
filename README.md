# ontology-sketch

A web-based ontology editor with an Excalidraw-like hand-drawn look that exports OWL 2.
Longer term it aims at Protégé-like editing of classes, properties, axioms and SHACL shapes.

## Stack

- **Canvas:** [React Flow](https://reactflow.dev) (`@xyflow/react`, MIT) for nodes and edges, with shapes drawn by [rough.js](https://roughjs.com) (MIT).
- **Font:** [Excalifont](https://plus.excalidraw.com/excalifont) (OFL-1.1), falling back to Shantell Sans (OFL-1.1).
- **RDF / OWL:** [N3.js](https://github.com/rdfjs/N3.js) (MIT) to write Turtle.
- **SHACL:** [shacl-engine](https://github.com/rdf-ext/shacl-engine) (MIT), installed for upcoming validation work.

## Current scope

- Classes as boxes; drag between boxes for `rdfs:subClassOf`.
- Double-click an edge and name it to turn it into an `owl:ObjectProperty` (domain = source, range = target).
- Export the ontology as OWL 2 in Turtle.

## Develop

```sh
npm install
npm run dev     # start the editor
npm test        # run unit tests
npm run build   # type-check and build
```
