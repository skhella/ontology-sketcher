"""Checks the OWL and SHACL export with independent RDF tools.

Run from the repository root:  pip install -r tests/semantics/requirements.txt && npm run test:semantics

It exports the fixture sketches with the app's own exporter (through vitest, see src/export.test.ts) and checks that
- both files parse (rdflib) and pyshacl loads the shapes file;
- the ontology file has no owl:Restriction, owl:allValuesFrom, rdfs:domain, rdfs:range or owl:unionOf;
- an Enterprise with a TechnicalItem as hasPart breaks the shapes, with a result naming hasPart,
  while data that follows the sketch conforms;
- an RDFS and OWL 2 RL reasoner over ontology + that data adds no type to the technical item,
  where it did with the export before this change (tests/semantics/golden).
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import owlrl
import pyshacl
from rdflib import Graph, Namespace, URIRef
from rdflib.namespace import OWL, RDF, RDFS, SH

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
EX = Namespace("https://w3id.org/plant-example#")
BANNED = ["owl:Restriction", "owl:allValuesFrom", "rdfs:domain", "rdfs:range", "owl:unionOf"]
# Types every individual gets from the reasoner, which say nothing about the sketch.
TRIVIAL = {OWL.Thing, RDFS.Resource}

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
    """The rdf:type values of `item` that the reasoner adds over ontology + data, without the trivial ones."""
    before = set(data.objects(item, RDF.type))
    graph = Graph()
    for g in (ontology, data):
        for triple in g:
            graph.add(triple)
    owlrl.DeductiveClosure(owlrl.RDFS_OWLRL_Semantics, axiomatic_triples=False).expand(graph)
    return {t for t in graph.objects(item, RDF.type) if t not in before and t not in TRIVIAL}


def main():
    out = Path(tempfile.mkdtemp(prefix="sketcher-export-"))
    env = {**os.environ, "SEMANTICS_OUT": str(out)}
    npx = "npx.cmd" if os.name == "nt" else "npx"
    run = subprocess.run([npx, "vitest", "run", "src/export.test.ts"], cwd=ROOT, env=env, capture_output=True, text=True)
    if run.returncode != 0:
        print(run.stdout + run.stderr)
        sys.exit("The export tests failed; see above.")

    for name in ["enterprise", "pizza-example"]:
        ontology_path, shapes_path = out / f"{name}.ttl", out / f"{name}-shapes.ttl"
        ontology, shapes = parse(ontology_path), parse(shapes_path)
        check(len(ontology) > 0 and len(shapes) > 0, f"{name}: both files parse with rdflib")
        loaded = pyshacl.validate(Graph(), shacl_graph=shapes, ont_graph=ontology)
        check(loaded[0] is True, f"{name}: pyshacl loads the shapes file")
        text = ontology_path.read_text(encoding="utf-8")
        found = [term for term in BANNED if term in text]
        check(not found, f"{name}: ontology file has none of {', '.join(BANNED)}" + (f" (found {found})" if found else ""))
        terms = {term for triple in ontology for term in triple}
        check(not terms & {OWL.Restriction, OWL.allValuesFrom, RDFS.domain, RDFS.range, OWL.unionOf}, f"{name}: no such IRI in the parsed ontology")
        check(len(list(shapes.subjects(RDF.type, SH.NodeShape))) > 0, f"{name}: shapes file has node shapes")
        check(not any(shapes.triples((None, SH.minCount, None))) and not any(shapes.triples((None, SH.maxCount, None))), f"{name}: no invented counts")

    ontology, shapes = parse(out / "enterprise.ttl"), parse(out / "enterprise-shapes.ttl")
    bad = parse(HERE / "fixtures" / "enterprise-bad-data.ttl")
    good = parse(HERE / "fixtures" / "enterprise-good-data.ttl")

    conforms, report, report_text = pyshacl.validate(bad, shacl_graph=shapes, ont_graph=ontology, inference="none")
    paths = set(report.objects(None, SH.resultPath))
    focus = set(report.objects(None, SH.focusNode))
    check(conforms is False, "Enterprise with a TechnicalItem as hasPart does not conform")
    check(EX.hasPart in paths and EX.acme in focus, "the violation is on :acme and names :hasPart")
    messages = [str(m) for m in report.objects(None, SH.resultMessage)]
    check(any("Enterprise" in m and "hasPart" in m and "OrganizationalUnit" in m and "Site" in m for m in messages), "its message names Enterprise, hasPart and the allowed targets")

    conforms, _, report_text = pyshacl.validate(good, shacl_graph=shapes, ont_graph=ontology, inference="rdfs")
    check(conforms is True, "data that follows the sketch conforms" + ("" if conforms else "\n" + report_text))

    added = types_after_reasoning(ontology, bad, EX.pump1)
    check(not added, "RDFS + OWL 2 RL reasoning over ontology + bad data adds no type to :pump1" + (f" (added {sorted(added)})" if added else ""))
    old = parse(HERE / "golden" / "enterprise.before.ttl")
    check(bool(types_after_reasoning(old, bad, EX.pump1)), "with the export before this change it did (the bug this guards against)")

    print()
    if failures:
        sys.exit(f"{len(failures)} check(s) failed.")
    print("All semantic checks passed.")


if __name__ == "__main__":
    main()
