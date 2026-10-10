# ontology-sketch

A web-based ontology editor with an Excalidraw-like hand-drawn look that exports OWL 2.
Longer term it aims at Protégé-like editing of classes, properties, axioms and SHACL shapes.

## Stack

- **Canvas:** [React Flow](https://reactflow.dev) (`@xyflow/react`, MIT) for nodes and edges, with shapes drawn by [rough.js](https://roughjs.com) (MIT).
- **Font:** [Excalifont](https://plus.excalidraw.com/excalifont) (OFL-1.1), falling back to Shantell Sans (OFL-1.1).
- **RDF / OWL:** [N3.js](https://github.com/rdfjs/N3.js) (MIT) to write Turtle.
- **SHACL:** [shacl-engine](https://github.com/rdf-ext/shacl-engine) (MIT), installed for upcoming validation work.

## Current scope

- Classes as boxes with a connection dot on each side; drag from a dot onto another box for `rdfs:subClassOf`.
  You can drop anywhere on the box: the edge locks to its dot nearest the pointer, which lights up while you hover.
- Double-click an edge and name it to turn it into an `owl:ObjectProperty` (domain = source, range = target).
- Export the ontology as OWL 2 in Turtle.
- Inspector for the selected class or edge, on the right: label, IRI (a local name, `prefix:name` or full IRI;
  derived from the label when empty), definition (`skos:definition`), comment (`rdfs:comment`) and any other
  annotation (SKOS, `rdfs:seeAlso`, Dublin Core or a custom property) with an optional language tag. Edges can be
  switched between subClassOf and object property there. Everything is exported; annotation properties that OWL 2
  doesn't build in are declared `owl:AnnotationProperty`.
- Class axioms in the inspector, laid out like Protégé's class description: SubClass Of (arrows drawn on the canvas
  are listed too), Equivalent To and Disjoint With. Each entry is a named class or a restriction on an object
  property drawn on the canvas, written in Manchester order (`has topping some Tomato Topping`, `exactly 2 Topping`)
  with `some`, `only`, `min`, `max` and `exactly`. Restrictions export as inline `owl:Restriction` blank nodes.
- Properties in the inspector: an edge is a subClassOf, an object property or an annotation property (asserted between
  the two classes). Object properties get characteristics (functional, inverse functional, transitive, symmetric,
  asymmetric, reflexive, irreflexive), an inverse and a super property; these apply to every edge with the same name.
  Classes list data properties like Neo4j property keys (name, `xsd` datatype, functional), exported as
  `owl:DatatypeProperty` with the class as domain; classes sharing a name share one property with a union domain.
- Style panel for the selection, like Excalidraw's: stroke and background colours (five swatches plus a custom
  picker), fill style, stroke width, stroke style and sloppiness. Select an edge and drag its midpoint dot to curve
  it; double-click the dot or use "Reset curve" to undo. Styles and curves are visual only and are not exported.
- Import an `.excalidraw` file: labelled rectangles, ellipses and diamonds become classes at the same spot;
  arrows bound to two of them become `rdfs:subClassOf` when unlabelled or labelled "SCO" or "subClassOf" (arrow
  points from subclass to superclass), otherwise an object property named after the label. Free text, lines, unlabelled shapes and loose
  arrows are skipped.
  Colours, fill, stroke and sloppiness carry over, curved arrows keep their bend, and each arrow end attaches to
  the dot on the side it touched.

## Develop

```sh
npm install
npm run dev     # start the editor
npm test        # run unit tests
npm run build   # type-check and build
```
