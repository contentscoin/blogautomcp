#!/usr/bin/env python3
"""Build canonical local ontology packs from Naver top-post research ledgers."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup


STAMP = "2026-08-30"
DEFAULT_ROOT = Path("docs") / f"naver-top-post-ontology-{STAMP}"

ALLOWED_NODE_TYPES = {
    "subject": {"Agent", "Team", "Org", "User"},
    "resource": {"Project", "Document", "Dataset", "CrawlRun"},
    "evidence": {"TextUnit", "Evidence"},
    "concept": {"Concept", "Topic", "Class"},
    "claim": {"Claim", "CollectionCompleteness"},
    "community": {"Community", "CommunityReport"},
    "outcome": {"Outcome", "KPI", "Risk"},
    "lever": {"Lever"},
    "policy": {"Policy", "ApprovalRule", "Sensitivity"},
}

ALLOWED_RELATIONS = {
    "subject>resource:owns",
    "subject>resource:manages",
    "subject>resource:can_view",
    "subject>resource:can_execute",
    "resource>evidence:contains",
    "resource>evidence:derived_from",
    "evidence>concept:describes",
    "evidence>concept:exemplifies",
    "evidence>claim:supports",
    "evidence>claim:contradicts",
    "concept>concept:related_to",
    "concept>concept:subclass_of",
    "concept>concept:part_of",
    "concept>outcome:contributes_to",
    "concept>outcome:constrains",
    "community>concept:clusters",
    "community>concept:summarizes",
    "lever>concept:affects",
    "lever>outcome:optimizes",
    "lever>outcome:stabilizes",
    "policy>resource:protects",
    "policy>resource:classifies",
    "policy>resource:restricts",
    "policy>subject:permits",
    "policy>subject:requires_approval",
}

PATTERN_LABELS = {
    "problem_or_motivation": "독자의 문제·선택 계기로 시작",
    "identity_or_summary": "대상의 정체와 핵심 요약",
    "first_impression": "첫인상·구성·디자인",
    "spec_or_facts": "확인된 사양·사실",
    "use_scene": "사용 과정과 상황",
    "comparison": "대안·기존 선택지 비교",
    "strength": "장점과 가치 해석",
    "limitation": "단점·제약·주의점",
    "fit": "추천·비추천 적합도",
    "price_or_value": "가격·포함 범위·가치",
    "checklist": "구매·예약 전 확인 항목",
    "conclusion": "조건부 결론",
    "affiliate_cta": "제휴 컴포넌트 연결",
    "affiliate_disclosure": "제휴 고지",
    "destination_orientation": "여행지 위치와 맥락",
    "itinerary_overview": "전체 일정과 코스 개요",
    "day_by_day": "일차별 전개",
    "transport": "항공·교통·이동",
    "lodging": "숙박과 휴식",
    "food": "식사와 음식 경험",
    "place_value": "여행지별 볼거리와 가치",
    "preparation": "날씨·준비물·사전 준비",
    "pace_or_fatigue": "동선·체력·여행 강도",
    "booking_conditions": "포함·불포함·예약 조건",
    "photo_story": "사진 중심 여행 장면",
    "first_person": "1인칭 서술",
    "experience_claim": "직접 체험 주장",
    "reader_address": "독자 직접 호명",
    "hedged_judgement": "조건부·완곡 판단",
    "decisive_judgement": "단정적 추천 판단",
    "comparison_tone": "비교·선택 기준 문체",
    "information_tone": "정보 정리 문체",
    "conversational": "대화형 요체",
    "sensory_scene": "감각·장면 묘사",
    "review_word": "후기·리뷰 제목",
    "recommendation_word": "추천 제목",
    "comparison_word": "비교·장단점 제목",
    "decision_word": "구매·예약 판단 제목",
    "number_word": "기간·숫자 제목",
    "clickbait_word": "과장·클릭 유도 제목",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_id(prefix: str, value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9가-힣_]+", "_", value).strip("_")[:72] or prefix
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}:{slug}:{digest}"


def clean_markup(value: str) -> str:
    value = value or ""
    if "<" not in value and ">" not in value:
        return re.sub(r"\s+", " ", value).strip()
    return re.sub(r"\s+", " ", BeautifulSoup(value, "html.parser").get_text(" ", strip=True)).strip()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def true_patterns(row: dict[str, Any]) -> list[tuple[str, str]]:
    analysis = row["analysis"]
    output: list[tuple[str, str]] = []
    for group, field in (
        ("structure", "structure_patterns"),
        ("tone", "tone_patterns"),
        ("title", "title_metrics"),
    ):
        values = analysis[field]["patterns"] if field == "title_metrics" else analysis[field]
        output.extend((group, key) for key, enabled in values.items() if enabled)
    image = analysis["image_metrics"]
    if image["count"] >= 10:
        output.append(("image", "image_10_plus"))
    if image["interleaving_ratio"] >= 0.45:
        output.append(("image", "text_image_interleaving"))
    if image["has_collage"]:
        output.append(("image", "collage"))
    return output


def add_node(nodes: dict[str, dict[str, Any]], node: dict[str, Any]) -> str:
    if node["node_type"] not in ALLOWED_NODE_TYPES[node["space"]]:
        raise ValueError(f"invalid node {node['space']}/{node['node_type']}")
    existing = nodes.get(node["id"])
    if existing:
        existing["evidence_refs"] = sorted(set(existing.get("evidence_refs", []) + node.get("evidence_refs", [])))
        existing["properties"].update(node.get("properties", {}))
    else:
        nodes[node["id"]] = node
    return node["id"]


def add_edge(
    edges: list[dict[str, Any]],
    nodes: dict[str, dict[str, Any]],
    from_id: str,
    to_id: str,
    relation: str,
    evidence_refs: list[str],
    properties: dict[str, Any] | None = None,
) -> str:
    source = nodes[from_id]
    target = nodes[to_id]
    grammar = f"{source['space']}>{target['space']}:{relation}"
    if grammar not in ALLOWED_RELATIONS:
        raise ValueError(f"invalid relation {grammar}")
    edge_id = stable_id("edge", f"{from_id}|{relation}|{to_id}|{len(edges)}")
    edges.append(
        {
            "id": edge_id,
            "from_id": from_id,
            "to_id": to_id,
            "from_space": source["space"],
            "to_space": target["space"],
            "relation": relation,
            "confidence": 0.94,
            "evidence_refs": sorted(set(evidence_refs)),
            "properties": properties or {},
        }
    )
    return edge_id


def concept_label(group: str, key: str) -> str:
    if key == "image_10_plus":
        return "이미지 10장 이상"
    if key == "text_image_interleaving":
        return "텍스트·이미지 교차 배치"
    if key == "collage":
        return "콜라주 이미지 사용"
    return PATTERN_LABELS.get(key, key)


def compact_evidence(row: dict[str, Any]) -> dict[str, Any]:
    analysis = row["analysis"]
    return {
        "category": row["category"],
        "query_group": row["query_group"],
        "query": row["query"],
        "rank": row["best_rank"],
        "url": row["url"],
        "title": clean_markup(analysis["title"]),
        "search_snippet": clean_markup(row.get("snippet", ""))[:280],
        "collected_at": row["fetch"]["collected_at"],
        "insane_search": {
            "verdict": row["fetch"]["verdict"],
            "summary": row["fetch"]["summary"],
        },
        "metrics": {
            "body_chars": analysis["body_char_count"],
            "paragraphs": analysis["paragraph_count"],
            "headings": analysis["heading_count"],
            "median_sentence_length": analysis["median_sentence_length"],
            "median_paragraph_length": analysis["median_paragraph_length"],
            "images": analysis["image_metrics"]["count"],
            "image_interleaving": analysis["image_metrics"]["interleaving_ratio"],
            "title_length": analysis["title_metrics"]["length"],
            "title_query_coverage": analysis["seo"]["title_token_coverage"],
            "early_query_coverage": analysis["seo"]["early_token_coverage"],
            "quality_score": analysis["quality_score"],
        },
        "patterns": [f"{group}:{key}" for group, key in true_patterns(row)],
        "section_sequence": analysis["section_sequence"],
        "headings_sample": [clean_markup(item)[:80] for item in analysis["headings"][:8]],
        "risk_signals": analysis["risk_signals"],
    }


def build_pack(root: Path, category: str) -> dict[str, Any]:
    category_dir = root / category
    ledger = load_jsonl(category_dir / "source-ledger.jsonl")
    summary = json.loads((category_dir / "analysis.json").read_text(encoding="utf-8"))
    if len(ledger) < 100:
        raise RuntimeError(f"{category}: ontology pack requires at least 100 valid sources")

    pack_id = f"naver-{category}-top-post-patterns-{STAMP}"
    pack_dir = root / "packs" / category
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    evidence_rows: list[dict[str, Any]] = []
    pattern_evidence: defaultdict[str, list[str]] = defaultdict(list)
    group_patterns: defaultdict[str, Counter[str]] = defaultdict(Counter)

    agent_id = add_node(
        nodes,
        {
            "id": stable_id("subject", "BlogAuto editorial intelligence agent"),
            "label": "BlogAuto 편집 지능 에이전트",
            "space": "subject",
            "node_type": "Agent",
            "properties": {"role": "evidence-grounded editorial guidance"},
            "evidence_refs": [],
            "quality": {"promotion_status": "validated", "confidence": 1.0},
        },
    )
    project_id = add_node(
        nodes,
        {
            "id": stable_id("resource", pack_id),
            "label": f"네이버 {category} 상위노출 패턴 프로젝트",
            "space": "resource",
            "node_type": "Project",
            "properties": {"pack_id": pack_id, "generated_at": now_iso(), "source_count": len(ledger)},
            "evidence_refs": [],
            "quality": {"promotion_status": "validated", "confidence": 0.98},
        },
    )
    dataset_id = add_node(
        nodes,
        {
            "id": stable_id("resource", f"{pack_id}:dataset"),
            "label": f"{category} 상위노출 출처 원장",
            "space": "resource",
            "node_type": "Dataset",
            "properties": {"source_path": f"{category}/source-ledger.jsonl", "rows": len(ledger)},
            "evidence_refs": [],
            "quality": {"promotion_status": "validated", "confidence": 0.98},
        },
    )
    crawl_id = add_node(
        nodes,
        {
            "id": stable_id("resource", f"{pack_id}:crawl"),
            "label": f"{category} Insane Search 수집 실행",
            "space": "resource",
            "node_type": "CrawlRun",
            "properties": summary["method"] | summary["counts"],
            "evidence_refs": [],
            "quality": {"promotion_status": "validated", "confidence": 0.98},
        },
    )
    outcome_id = add_node(
        nodes,
        {
            "id": stable_id("outcome", f"{category}:top-search-exposure"),
            "label": "현재 네이버 블로그 상위노출과의 관측 연관",
            "space": "outcome",
            "node_type": "Outcome",
            "properties": {"causal": False, "ranking_scope": summary["method"]["ranking_definition"]},
            "evidence_refs": [],
            "quality": {"promotion_status": "validated", "confidence": 0.8},
        },
    )
    concept_ids: dict[str, str] = {}
    for row_index, row in enumerate(ledger, start=1):
        compact = compact_evidence(row)
        document_id = add_node(
            nodes,
            {
                "id": stable_id("resource", row["url"]),
                "label": compact["title"][:100],
                "space": "resource",
                "node_type": "Document",
                "properties": {
                    "source_url": row["url"],
                    "query": row["query"],
                    "rank": row["best_rank"],
                    "query_group": row["query_group"],
                    "collected_at": row["fetch"]["collected_at"],
                },
                "evidence_refs": [],
                "quality": {"promotion_status": "validated", "confidence": 0.94},
            },
        )
        evidence_id = add_node(
            nodes,
            {
                "id": stable_id("evidence", f"{row['url']}:derived-patterns"),
                "label": f"상위 {row['best_rank']}위 파생 패턴 · {compact['title'][:70]}",
                "space": "evidence",
                "node_type": "TextUnit",
                "properties": compact,
                "evidence_refs": [],
                "quality": {"promotion_status": "validated", "confidence": 0.94},
            },
        )
        nodes[evidence_id]["evidence_refs"] = [evidence_id]
        nodes[document_id]["evidence_refs"] = [evidence_id]
        nodes[dataset_id]["evidence_refs"].append(evidence_id)
        nodes[crawl_id]["evidence_refs"].append(evidence_id)
        nodes[project_id]["evidence_refs"].append(evidence_id)
        evidence_rows.append(
            {
                "evidence_id": evidence_id,
                "kind": "derived_editorial_metrics",
                "source": {"url": row["url"], "title": compact["title"], "path": f"{category}/source-ledger.jsonl#line:{row_index}"},
                "collected_at": row["fetch"]["collected_at"],
                "parser": {"method": "insane-search+naver-pattern-extractor", "status": "ok", "warnings": row["analysis"]["risk_signals"]},
                "text": json.dumps(compact, ensure_ascii=False, separators=(",", ":")),
                "hash": f"sha256:{hashlib.sha256(json.dumps(compact, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()}",
                "location": {"document_id": document_id, "section": "derived-patterns", "chunk_index": row_index},
                "links": {"document_id": document_id, "node_ids": [document_id, evidence_id], "edge_ids": []},
            }
        )
        add_edge(edges, nodes, document_id, evidence_id, "contains", [evidence_id])
        add_edge(edges, nodes, dataset_id, evidence_id, "contains", [evidence_id], {"row": row_index})
        add_edge(edges, nodes, crawl_id, evidence_id, "contains", [evidence_id], {"query": row["query"], "rank": row["best_rank"]})
        for group, key in true_patterns(row):
            concept_key = f"{group}:{key}"
            concept_id = concept_ids.get(concept_key)
            if not concept_id:
                concept_id = add_node(
                    nodes,
                    {
                        "id": stable_id("concept", f"{category}:{concept_key}"),
                        "label": concept_label(group, key),
                        "space": "concept",
                        "node_type": "Concept",
                        "properties": {"category": category, "pattern_group": group, "pattern_key": key},
                        "evidence_refs": [],
                        "quality": {"promotion_status": "validated", "confidence": 0.9},
                    },
                )
                concept_ids[concept_key] = concept_id
            nodes[concept_id]["evidence_refs"].append(evidence_id)
            pattern_evidence[concept_key].append(evidence_id)
            group_patterns[row["query_group"]][concept_key] += 1
            add_edge(edges, nodes, evidence_id, concept_id, "exemplifies", [evidence_id])

    all_source_evidence = sorted(set(nodes[dataset_id]["evidence_refs"]))
    add_edge(edges, nodes, agent_id, project_id, "owns", all_source_evidence)
    add_edge(edges, nodes, agent_id, project_id, "manages", all_source_evidence)

    claim_ids: dict[str, str] = {}
    prevalence_groups = {
        "structure": summary["structure_prevalence"],
        "tone": summary["tone_prevalence"],
        "title": summary["title_prevalence"],
    }
    for group, items in prevalence_groups.items():
        for item in items:
            if item["percent"] < 20:
                continue
            key = item["pattern"]
            concept_key = f"{group}:{key}"
            evidence_refs = pattern_evidence.get(concept_key, [])
            if not evidence_refs:
                continue
            claim_id = add_node(
                nodes,
                {
                    "id": stable_id("claim", f"{category}:{concept_key}:prevalence"),
                    "label": f"{concept_label(group, key)} · {item['percent']}% 관측",
                    "space": "claim",
                    "node_type": "Claim",
                    "properties": {
                        "claim_type": "observed_prevalence",
                        "count": item["count"],
                        "denominator": summary["counts"]["quality_eligible_posts"],
                        "percent": item["percent"],
                        "causal": False,
                    },
                    "evidence_refs": evidence_refs,
                    "quality": {"promotion_status": "validated", "confidence": 0.88},
                },
            )
            claim_ids[concept_key] = claim_id
            for evidence_id in evidence_refs:
                add_edge(edges, nodes, evidence_id, claim_id, "supports", [evidence_id])
            concept_id = concept_ids[concept_key]
            add_edge(edges, nodes, concept_id, outcome_id, "contributes_to", evidence_refs, {"causal": False, "percent": item["percent"]})

    for group_name, counts in group_patterns.items():
        community_id = add_node(
            nodes,
            {
                "id": stable_id("community", f"{category}:{group_name}"),
                "label": f"{group_name} 검색군",
                "space": "community",
                "node_type": "Community",
                "properties": {"category": category, "query_group": group_name, "top_patterns": counts.most_common(10)},
                "evidence_refs": [],
                "quality": {"promotion_status": "validated", "confidence": 0.86},
            },
        )
        for concept_key, _ in counts.most_common(10):
            concept_id = concept_ids[concept_key]
            refs = pattern_evidence[concept_key]
            nodes[community_id]["evidence_refs"].extend(refs)
            add_edge(edges, nodes, community_id, concept_id, "clusters", refs, {"query_group": group_name})

    lever_specs = [
        ("evidence_first_analysis", "상품·일정 근거를 먼저 분석하고 판단 축을 선택"),
        ("adaptive_narrative", "고정 목차 대신 독자 질문에 맞춘 자유 전개"),
        ("reader_decision_support", "장점·제약·적합도·보류 조건을 함께 제시"),
        ("image_text_interleaving", "사진 장면과 설명을 교차 배치"),
        ("anti_template_guard", "하네스 문구 복사와 빈 문단 채우기를 차단"),
    ]
    high_concepts = [
        concept_ids[f"structure:{item['pattern']}"]
        for item in summary["structure_prevalence"][:8]
        if f"structure:{item['pattern']}" in concept_ids
    ]
    for key, label in lever_specs:
        lever_id = add_node(
            nodes,
            {
                "id": stable_id("lever", f"{category}:{key}"),
                "label": label,
                "space": "lever",
                "node_type": "Lever",
                "properties": {"category": category, "key": key},
                "evidence_refs": sorted(set(ref for cid in high_concepts for ref in nodes[cid]["evidence_refs"])),
                "quality": {"promotion_status": "validated", "confidence": 0.86},
            },
        )
        for concept_id in high_concepts[:5]:
            add_edge(edges, nodes, lever_id, concept_id, "affects", nodes[concept_id]["evidence_refs"])
        add_edge(edges, nodes, lever_id, outcome_id, "stabilizes", nodes[lever_id]["evidence_refs"], {"causal": False})

    policy_specs = [
        ("copyright_minimization", "원문 전체 미보존·파생 지표와 짧은 인용만 허용"),
        ("correlation_boundary", "상위노출 동반 패턴을 순위 원인으로 단정 금지"),
        ("experience_integrity", "검증된 체험 메모가 없으면 직접 사용·방문 경험 생성 금지"),
        ("source_traceability", "모든 판단은 검색어·순위·URL·수집시각으로 추적 가능해야 함"),
    ]
    for key, label in policy_specs:
        policy_id = add_node(
            nodes,
            {
                "id": stable_id("policy", f"{category}:{key}"),
                "label": label,
                "space": "policy",
                "node_type": "Policy",
                "properties": {"category": category, "key": key},
                "evidence_refs": nodes[dataset_id]["evidence_refs"],
                "quality": {"promotion_status": "validated", "confidence": 1.0},
            },
        )
        add_edge(edges, nodes, policy_id, dataset_id, "protects", nodes[dataset_id]["evidence_refs"])
        add_edge(edges, nodes, policy_id, agent_id, "requires_approval", nodes[dataset_id]["evidence_refs"])

    node_rows = list(nodes.values())
    for node in node_rows:
        node["evidence_refs"] = sorted(set(node.get("evidence_refs", [])))
    node_ids = set(nodes)
    evidence_ids = {row["evidence_id"] for row in evidence_rows}
    broken_edges = [edge["id"] for edge in edges if edge["from_id"] not in node_ids or edge["to_id"] not in node_ids]
    invalid_edges = [
        edge["id"]
        for edge in edges
        if f"{edge['from_space']}>{edge['to_space']}:{edge['relation']}" not in ALLOWED_RELATIONS
    ]
    missing_evidence_refs = sorted(
        {
            ref
            for item in [*node_rows, *edges]
            for ref in item.get("evidence_refs", [])
            if ref not in evidence_ids
        }
    )
    edges_without_evidence = [edge["id"] for edge in edges if not edge.get("evidence_refs")]
    source_urls = {row["url"] for row in ledger}
    evidence_urls = {row["source"]["url"] for row in evidence_rows}
    qa = {
        "status": "pass" if not broken_edges and not invalid_edges and not missing_evidence_refs and not edges_without_evidence and source_urls == evidence_urls else "fail",
        "source_count": len(source_urls),
        "evidence_count": len(evidence_rows),
        "node_count": len(node_rows),
        "edge_count": len(edges),
        "broken_edges": broken_edges,
        "invalid_edges": invalid_edges,
        "missing_evidence_refs": missing_evidence_refs,
        "edges_without_evidence": edges_without_evidence,
        "source_evidence_closure": source_urls == evidence_urls,
        "all_sources_insane_search_validated": all(row["fetch"]["ok"] and row["fetch"]["verdict"] in {"strong_ok", "weak_ok"} for row in ledger),
        "full_post_bodies_persisted": False,
    }
    if qa["status"] != "pass":
        raise RuntimeError(f"{category} pack QA failed: {qa}")

    pack_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(pack_dir / "graph" / "nodes.jsonl", node_rows)
    write_jsonl(pack_dir / "graph" / "edges.jsonl", edges)
    write_jsonl(pack_dir / "evidence" / "index.jsonl", evidence_rows)
    (pack_dir / "reports").mkdir(parents=True, exist_ok=True)
    (pack_dir / "reports" / "pack-qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=2), encoding="utf-8")
    (pack_dir / "reports" / "analysis.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (pack_dir / "reports" / "analysis.md").write_text((category_dir / "analysis.md").read_text(encoding="utf-8"), encoding="utf-8")

    ingest_lines = [
        f"# Naver {category} top-post ontology {STAMP}",
        "",
        f"- Sources: {len(ledger)} current top-ranked Naver Blog posts",
        f"- Ranking: {summary['method']['ranking_definition']}",
        "- Boundary: observed association, not ranking causation",
        "- Copyright: no full post bodies; derived metrics and short labels only",
        "",
        "## Aggregate patterns",
    ]
    for group, items in prevalence_groups.items():
        ingest_lines.append(f"### {group}")
        ingest_lines.extend(
            f"PATTERN|group={group}|key={item['pattern']}|label={concept_label(group, item['pattern'])}|count={item['count']}|percent={item['percent']}|causal=false"
            for item in items
        )
    ingest_lines.extend(["", "## Source evidence ledger"])
    for index, row in enumerate(ledger, start=1):
        compact = compact_evidence(row)
        ingest_lines.append(
            "EVIDENCE|"
            f"id={index:03d}|rank={compact['rank']}|group={compact['query_group']}|query={compact['query']}|"
            f"url={compact['url']}|title={compact['title'][:100]}|chars={compact['metrics']['body_chars']}|"
            f"images={compact['metrics']['images']}|quality={compact['metrics']['quality_score']}|"
            f"patterns={','.join(compact['patterns'][:16])}|risks={','.join(compact['risk_signals']) or 'none'}"
        )
    ingest_text = "\n".join(ingest_lines) + "\n"
    (pack_dir / "opencrab-ingest.md").write_text(ingest_text, encoding="utf-8")

    files = {
        "nodes": "graph/nodes.jsonl",
        "edges": "graph/edges.jsonl",
        "evidence": "evidence/index.jsonl",
        "qa": "reports/pack-qa.json",
        "analysis": "reports/analysis.json",
        "opencrab_ingest": "opencrab-ingest.md",
    }
    manifest = {
        "schema": "opencrab-canonical-ontology-pack/v1",
        "metaontology_profile": "metaontology-os-9-space/v1",
        "pack_id": pack_id,
        "title": f"Naver {category} Top Post Editorial Patterns {STAMP}",
        "category": category,
        "generated_at": now_iso(),
        "visibility": "private",
        "source_count": len(ledger),
        "source_policy": "provenance_and_derived_metrics_only",
        "ranking_definition": summary["method"]["ranking_definition"],
        "quality": qa,
        "files": files,
        "sha256": {},
    }
    for key, relative in files.items():
        manifest["sha256"][key] = sha256_bytes((pack_dir / relative).read_bytes())
    (pack_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    zip_path = root / "packs" / f"{pack_id}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(pack_dir.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(pack_dir).as_posix())
    manifest["zip"] = {"path": str(zip_path.relative_to(root)), "sha256": sha256_bytes(zip_path.read_bytes()), "bytes": zip_path.stat().st_size}
    (pack_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--category", choices=("shopping", "travel", "all"), default="all")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    categories = [args.category] if args.category != "all" else ["shopping", "travel"]
    manifests = {category: build_pack(args.root, category) for category in categories}
    (args.root / "packs" / "pack-index.json").write_text(
        json.dumps(manifests, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({key: value["quality"] for key, value in manifests.items()}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
