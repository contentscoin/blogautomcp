#!/usr/bin/env python3
"""Fail-closed checks for the Naver top-post research ledgers and ontology packs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs" / "naver-top-post-ontology-2026-08-30"
CATEGORIES = ("shopping", "travel")
MINIMUM_SOURCES = 100


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_hashes(base: Path, manifest: dict) -> None:
    for name, expected in manifest["sha256"].items():
        relative = manifest["files"][name]
        actual = sha256(base / relative)
        assert actual == expected, f"hash mismatch: {base / relative}"


def verify_category(category: str) -> dict:
    research_dir = BASE / category
    pack_dir = BASE / "packs" / category
    research_manifest = read_json(research_dir / "manifest.json")
    pack_manifest = read_json(pack_dir / "manifest.json")
    rows = read_jsonl(research_dir / "source-ledger.jsonl")
    nodes = read_jsonl(pack_dir / "graph" / "nodes.jsonl")
    edges = read_jsonl(pack_dir / "graph" / "edges.jsonl")
    evidence = read_jsonl(pack_dir / "evidence" / "index.jsonl")
    qa = read_json(pack_dir / "reports" / "pack-qa.json")

    assert len(rows) >= MINIMUM_SOURCES, f"{category}: fewer than {MINIMUM_SOURCES} sources"
    assert len(rows) == research_manifest["counts"]["valid_posts"]
    assert len(rows) == pack_manifest["source_count"]
    assert len(evidence) == len(rows)
    assert len({row["url"] for row in rows}) == len(rows), f"{category}: duplicate URLs"
    assert all(row.get("valid") for row in rows), f"{category}: invalid source in durable ledger"
    assert all(row.get("fetch", {}).get("ok") for row in rows), f"{category}: unverified fetch"
    assert all(
        row.get("fetch", {}).get("verdict") in {"strong_ok", "soft_ok"}
        for row in rows
    ), f"{category}: unexpected Insane Search verdict"
    assert all("body" not in row and "html" not in row for row in rows), (
        f"{category}: full copyrighted body/html must not be persisted"
    )
    assert all("<mark>" not in row.get("snippet", "") for row in rows), (
        f"{category}: search markup leaked into the source ledger"
    )

    verify_hashes(research_dir, research_manifest)
    verify_hashes(pack_dir, pack_manifest)

    node_ids = {node["id"] for node in nodes}
    evidence_ids = {item["evidence_id"] for item in evidence}
    assert len(node_ids) == len(nodes), f"{category}: duplicate node IDs"
    assert len(evidence_ids) == len(evidence), f"{category}: duplicate evidence IDs"
    assert all(edge["from_id"] in node_ids and edge["to_id"] in node_ids for edge in edges), (
        f"{category}: broken graph edge"
    )
    assert all(edge.get("evidence_refs") for edge in edges), f"{category}: edge without evidence"
    assert all(
        evidence_id in evidence_ids
        for edge in edges
        for evidence_id in edge.get("evidence_refs", [])
    ), f"{category}: missing evidence reference"

    assert qa["status"] == "pass"
    assert qa["source_evidence_closure"] is True
    assert qa["all_sources_insane_search_validated"] is True
    assert qa["full_post_bodies_persisted"] is False
    assert not qa["broken_edges"]
    assert not qa["invalid_edges"]
    assert not qa["missing_evidence_refs"]
    assert not qa["edges_without_evidence"]

    zip_path = BASE / "packs" / f"naver-{category}-top-post-patterns-2026-08-30.zip"
    assert zip_path.exists() and zip_path.stat().st_size > 0
    assert sha256(zip_path) == pack_manifest["zip"]["sha256"]
    with ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        for required in (
            "manifest.json",
            "graph/nodes.jsonl",
            "graph/edges.jsonl",
            "evidence/index.jsonl",
            "reports/pack-qa.json",
            "opencrab-ingest.md",
        ):
            assert required in names, f"{category}: missing zip member {required}"

    return {
        "category": category,
        "sources": len(rows),
        "nodes": len(nodes),
        "edges": len(edges),
        "evidence": len(evidence),
        "zip_sha256": sha256(zip_path),
    }


def main() -> int:
    results = [verify_category(category) for category in CATEGORIES]
    summary = read_json(BASE / "research-summary.json")
    assert set(CATEGORIES).issubset(summary), "combined research summary is incomplete"
    registration = read_json(BASE / "opencrab-registration.json")
    assert registration["project"]["package_count"] == 3
    assert registration["project"]["status"] == "active"
    for category in CATEGORIES:
        remote = registration["packages"][category]
        assert remote["source_count"] >= MINIMUM_SOURCES
        assert remote["qa_grade"] == "A" and remote["qa_score"] == 100
        assert remote["release_ready"] is True
        assert remote["retrieval_spot_check"] == "pass"
    harness = registration["packages"]["harness"]
    assert harness["qa_grade"] == "A" and harness["retrieval_spot_check"] == "pass"
    print(json.dumps({"ok": True, "packs": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
