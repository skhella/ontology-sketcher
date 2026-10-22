"""Checks the OWL export, and the optional SHACL shapes, with independent RDF tools.

Run from the repository root:  pip install -r tests/semantics/requirements.txt && npm run test:semantics

It exports the fixture sketches with the app's own exporter (through vitest, see src/export.test.ts) and checks that
- the ontology files parse (rdflib) and keep what the sketch draws as OWL and RDFS: rdfs:domain, rdfs:range,
  owl:unionOf for several targets and owl:allValuesFrom restrictions;
- an RDFS and OWL 2 RL reasoner draws from them what OWL says they mean;
- a shapes file from a constraint the user added loads in pyshacl, holds only that constraint, and checks data.
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import owlrl
import pyshacl
from rdflib import Graph, Namespace
from rdflib.namespace import OWL, RDF, RDFS, SH

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
EX = Namespace("https://w3id.org/plant-example#")

failures = []


def check(ok, what):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def parse(path):
    graph = Graph()
    graph.parse(path, format="turtle")
    return graph


def types_after_reasoning(ontology, data, item):
    """The rdf:type values of `item` over ontology + data after RDFS and OWL 2 RL reasoning."""
    graph = Graph()
    for g in (ontology, data):
        for triple in g:
            graph.add(triple)
    owlrl.DeductiveClosure(owlrl.RDFS_OWLRL_Semantics, axiomatic_triples=False).expand(graph)
    return set(graph.objects(item, RDF.type))


def main():
    out = Path(tempfile.mkdtemp(prefix="sketcher-export-"))
    env = {**os.environ, "SEMANTICS_OUT": str(out)}
    npx = "npx.cmd" if os.name == "nt" else "npx"
    run = subprocess.run([npx, "vitest", "run", "src/export.test.ts"], cwd=ROOT, env=env, capture_output=True, text=True)
    if run.returncode != 0:
        print(run.stdout + run.stderr)
        sys.exit("The export tests failed; see above.")

    for name in ["enterprise", "pizza-example"]:
        ontology = parse(out / f"{name}.ttl")
        check(len(ontology) > 0, f"{name}: the ontology parses with rdflib")
        predicates = set(ontology.predicates())
        check(RDFS.domain in predicates and RDFS.range in predicates, f"{name}: drawn arrows keep rdfs:domain and rdfs:range")

    ontology = parse(out / "enterprise.ttl")
    check(any(ontology.triples((None, OWL.unionOf, None))), "enterprise: a property drawn to several classes has a union range")
    check(any(ontology.triples((None, OWL.allValuesFrom, None))), "enterprise: per-class targets are owl:allValuesFrom restrictions")

    bad = parse(HERE / "fixtures" / "enterprise-bad-data.ttl")
    good = parse(HERE / "fixtures" / "enterprise-good-data.ttl")
    # :pump1 locatedAt :somewhere, and a part of it: rdfs:range Site and TechnicalItem ⊑ ∀hasPart.Component apply.
    data = Graph()
    data.parse(data="@prefix : <https://w3id.org/plant-example#> . :pump1 a :TechnicalItem ; :locatedAt :somewhere ; :hasPart :seal .", format="turtle")
    check(EX.Site in types_after_reasoning(ontology, data, EX.somewhere), "the reasoner applies rdfs:range, as RDFS says")
    check(EX.Component in types_after_reasoning(ontology, data, EX.seal), "the reasoner applies owl:allValuesFrom, as OWL says")

    shapes = parse(out / "enterprise-constraint-shapes.ttl")
    loaded = pyshacl.validate(Graph(), shacl_graph=shapes, ont_graph=ontology)
    check(loaded[0] is True, "pyshacl loads the shapes file")
    check(len(list(shapes.objects(None, SH.property))) == 1, "the shapes file holds only the constraint the user added")
    conforms, report, _ = pyshacl.validate(bad, shacl_graph=shapes, ont_graph=ontology, inference="none")
    check(conforms is False and EX.legalName in set(report.objects(None, SH.resultPath)), "an enterprise without a legal name breaks it")
    conforms, _, report_text = pyshacl.validate(good, shacl_graph=shapes, ont_graph=ontology, inference="none")
    check(conforms is True, "an enterprise with a legal name conforms" + ("" if conforms else "\n" + report_text))

    print()
    if failures:
        sys.exit(f"{len(failures)} check(s) failed.")
    print("All semantic checks passed.")


if __name__ == "__main__":
    main()
