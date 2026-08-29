#!/usr/bin/env python3
"""Collect and analyze current top-ranked Naver Blog posts through Insane Search.

The script intentionally does not persist full copyrighted post bodies. It stores
rank/source provenance plus derived editorial metrics, short search snippets, and
short heading labels needed for reproducible pattern analysis.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import json
import os
import re
import statistics
import sys
import threading
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

from bs4 import BeautifulSoup


STAMP = "2026-08-30"
DEFAULT_OUTPUT = Path("docs") / f"naver-top-post-ontology-{STAMP}"
RESULTS_PER_QUERY = 6
MIN_BODY_CHARS = 650


SHOPPING_QUERIES = [
    ("home_appliance", "무선 선풍기 추천 후기"),
    ("home_appliance", "로봇청소기 추천 비교 후기"),
    ("home_appliance", "음식물처리기 후기 장단점"),
    ("home_appliance", "무선청소기 추천 사용 후기"),
    ("digital_it", "노트북 추천 사용 후기"),
    ("digital_it", "블루투스 이어폰 추천 비교"),
    ("digital_it", "기계식 키보드 추천 후기"),
    ("digital_it", "보조배터리 추천 사용 후기"),
    ("beauty_body", "헤어드라이어 추천 후기"),
    ("beauty_body", "선크림 추천 사용 후기"),
    ("beauty_body", "샴푸 추천 솔직 후기"),
    ("beauty_body", "홈케어 미용기기 후기 장단점"),
    ("living_health", "자세교정 방석 후기 장단점"),
    ("living_health", "주방세제 추천 사용 후기"),
    ("living_health", "여름 보냉백 추천 후기"),
    ("food_supplement", "유산균 추천 후기 비교"),
    ("food_supplement", "단백질 보충제 추천 후기"),
    ("food_supplement", "건강 간식 추천 후기"),
    ("sports_leisure", "골프 거리측정기 후기 비교"),
    ("sports_leisure", "캠핑 선풍기 추천 후기"),
    ("sports_leisure", "러닝화 추천 착용 후기"),
    ("fashion_goods", "여름 반바지 추천 착용 후기"),
    ("baby_pet", "강아지 간식 추천 급여 후기"),
    ("baby_pet", "아기 장난감 추천 사용 후기"),
]


TRAVEL_QUERIES = [
    ("japan", "일본 패키지여행 후기 일정"),
    ("japan", "오사카 패키지여행 후기 코스"),
    ("japan", "도쿄 패키지여행 후기 일정"),
    ("japan", "오키나와 패키지여행 후기"),
    ("taiwan", "대만 타이베이 패키지여행 후기"),
    ("taiwan", "타이페이 단수이 여행 코스 후기"),
    ("vietnam", "다낭 패키지여행 후기 일정"),
    ("vietnam", "나트랑 패키지여행 후기"),
    ("thailand", "방콕 패키지여행 후기 코스"),
    ("indonesia", "발리 패키지여행 후기 일정"),
    ("europe", "스페인 포르투갈 패키지여행 후기"),
    ("europe", "이탈리아 패키지여행 후기 일정"),
    ("europe", "스위스 패키지여행 후기 코스"),
    ("europe", "동유럽 패키지여행 후기"),
    ("europe", "튀르키예 패키지여행 후기 일정"),
    ("europe", "프랑스 파리 패키지여행 후기"),
    ("americas", "미국 뉴욕 패키지여행 후기"),
    ("oceania", "호주 시드니 패키지여행 후기"),
    ("pacific", "괌 패키지여행 후기 일정"),
    ("pacific", "사이판 패키지여행 후기"),
    ("hongkong", "홍콩 마카오 패키지여행 후기"),
    ("china", "장가계 패키지여행 후기 일정"),
    ("canada", "캐나다 패키지여행 후기 코스"),
    ("cruise", "크루즈 패키지여행 후기 일정"),
]


COMMON_STRUCTURE_PATTERNS: dict[str, tuple[str, ...]] = {
    "problem_or_motivation": ("고민", "필요", "찾다가", "선택", "계기", "알아보"),
    "identity_or_summary": ("어떤 제품", "어떤 상품", "한눈에", "요약", "먼저", "특징"),
    "first_impression": ("첫인상", "언박싱", "개봉", "포장", "구성품", "디자인"),
    "spec_or_facts": ("스펙", "사양", "소재", "크기", "무게", "성분", "기능", "구성"),
    "use_scene": ("사용해", "써보", "착용", "먹어", "발라", "설치", "조작", "실제로"),
    "comparison": ("비교", "차이", "대비", "기존", "다른 제품", "대안"),
    "strength": ("장점", "좋았", "마음에", "편했", "강점", "만족"),
    "limitation": ("단점", "아쉬", "불편", "주의", "다만", "아쉽"),
    "fit": ("추천 대상", "이런 분", "잘 맞", "적합", "추천해", "비추천"),
    "price_or_value": ("가격", "할인", "쿠폰", "가성비", "비용", "구매가"),
    "checklist": ("체크리스트", "구매 전", "확인할", "체크할", "예약 전"),
    "conclusion": ("총평", "마무리", "결론", "정리하면", "한줄평", "최종"),
    "affiliate_cta": ("구매 링크", "예약 링크", "상세 정보", "보러 가기", "확인하기", "커넥트"),
    "affiliate_disclosure": ("수수료", "활동의 일환", "제공받", "원고료", "협찬"),
}


TRAVEL_STRUCTURE_PATTERNS: dict[str, tuple[str, ...]] = {
    "destination_orientation": ("위치", "어디", "여행지", "도시", "지역", "나라"),
    "itinerary_overview": ("일정", "코스", "동선", "몇 박", "박 일", "여정"),
    "day_by_day": ("1일차", "2일차", "3일차", "첫째 날", "둘째 날", "day 1"),
    "transport": ("항공", "비행", "공항", "버스", "기차", "이동", "픽업"),
    "lodging": ("호텔", "숙소", "객실", "체크인", "조식", "연박"),
    "food": ("식사", "맛집", "먹었", "음식", "조식", "석식"),
    "place_value": ("볼거리", "명소", "풍경", "전망", "역사", "문화", "분위기"),
    "preparation": ("준비물", "날씨", "옷차림", "환전", "유심", "여행자보험"),
    "pace_or_fatigue": ("체력", "도보", "빡빡", "여유", "이동시간", "피로"),
    "booking_conditions": ("포함", "불포함", "선택관광", "취소", "예약", "출발확정"),
    "photo_story": ("사진으로", "사진을", "포토존", "촬영", "인생샷", "카메라"),
}


TONE_PATTERNS: dict[str, tuple[str, ...]] = {
    "first_person": ("저는", "제가", "저희", "우리 가족", "아이와", "남편과", "친구와"),
    "experience_claim": ("다녀왔", "써봤", "사용해봤", "구매했", "먹어봤", "묵었", "타봤"),
    "reader_address": ("여러분", "분들이라면", "찾는 분", "고민 중", "궁금하신"),
    "hedged_judgement": ("수 있어", "것 같", "느껴졌", "편이", "경우", "따라 다르"),
    "decisive_judgement": ("추천합니다", "추천해요", "꼭", "무조건", "강추", "최고"),
    "comparison_tone": ("비교", "반면", "대신", "차이", "기준", "선택"),
    "information_tone": ("정리", "정보", "방법", "팁", "체크", "참고"),
    "conversational": ("ㅎㅎ", "ㅋㅋ", "네요", "거든요", "더라고요", "했어요"),
    "sensory_scene": ("바람", "촉감", "향", "소리", "맛", "햇살", "야경", "공기", "눈앞"),
}


TITLE_PATTERNS: dict[str, tuple[str, ...]] = {
    "review_word": ("후기", "리뷰", "사용기", "체험기"),
    "recommendation_word": ("추천", "강추"),
    "comparison_word": ("비교", "장단점", "차이"),
    "decision_word": ("구매 전", "선택", "예약 전", "체크"),
    "number_word": ("1박", "2박", "3박", "4박", "5박", "6박", "7박", "8박", "9박", "일차"),
    "clickbait_word": ("완벽", "총정리", "필수", "무조건", "인생", "대박", "최고"),
}


SPAM_MARKERS = (
    "강추 보기",
    "언제나 좋은 기분",
    "별점 :",
    "가격은 역시",
    "지금 바로 구매",
    "놓치지 마세요",
    "최저가",
    "무조건 추천",
    "대박 상품",
)


@dataclass(frozen=True)
class QuerySpec:
    group: str
    query: str
    order: int


_PRINT_LOCK = threading.Lock()


def log(message: str) -> None:
    with _PRINT_LOCK:
        print(message, flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value.replace("\u200b", " ").replace("\xa0", " ")).strip()


def clean_markup(value: str | None) -> str:
    normalized = clean_text(value)
    if not normalized or "<" not in normalized:
        return normalized
    return clean_text(BeautifulSoup(normalized, "html.parser").get_text(" ", strip=True))


def decode_json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except (json.JSONDecodeError, TypeError):
        return value.replace("\\/", "/").replace("\\u002F", "/")


def canonical_post_url(value: str) -> str | None:
    value = decode_json_string(value).replace("http://", "https://")
    match = re.search(r"blog\.naver\.com/([A-Za-z0-9_.-]+)/([0-9]+)", value)
    if not match:
        return None
    return f"https://blog.naver.com/{match.group(1)}/{match.group(2)}"


def mobile_post_url(value: str) -> str:
    match = re.search(r"blog\.naver\.com/([A-Za-z0-9_.-]+)/([0-9]+)", value)
    if not match:
        return value.replace("https://blog.naver.com/", "https://m.blog.naver.com/")
    return (
        "https://m.blog.naver.com/PostView.naver?"
        f"blogId={quote(match.group(1))}&logNo={match.group(2)}"
    )


def find_field(segment: str, field: str) -> str:
    match = re.search(rf'"{re.escape(field)}":"((?:\\.|[^"\\])*)"', segment)
    if not match:
        return ""
    decoded = decode_json_string(match.group(1))
    return clean_text(BeautifulSoup(decoded, "html.parser").get_text(" ", strip=True))


def parse_search_results(html: str, query: QuerySpec, collected_at: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in re.finditer(r'"contentHref":"(https://blog\.naver\.com/[^"\\]+)', html):
        canonical = canonical_post_url(match.group(1))
        if not canonical or canonical in seen:
            continue
        seen.add(canonical)
        start = max(0, match.start() - 3200)
        end = min(len(html), match.start() + 6500)
        segment = html[start:end]
        image_match = re.search(r'"imageCount":([0-9]+)', segment)
        results.append(
            {
                "rank": len(results) + 1,
                "url": canonical,
                "query": query.query,
                "query_group": query.group,
                "query_order": query.order,
                "title": find_field(segment, "title"),
                "snippet": find_field(segment, "content")[:280],
                "published_hint": find_field(segment, "createdDate"),
                "blog_name": find_field(segment, "title") if "sourceProfile" in segment else "",
                "search_image_count": int(image_match.group(1)) if image_match else 0,
                "search_collected_at": collected_at,
            }
        )
        if len(results) >= 10:
            break
    return results


def load_insane_search() -> tuple[Any, Path]:
    candidates = [
        Path(os.environ.get("INSANE_SEARCH_ROOT", "")) if os.environ.get("INSANE_SEARCH_ROOT") else None,
        Path.home() / ".codex" / "skills" / "insane-search",
        Path.home() / ".agents" / "skills" / "insane-search",
    ]
    root = next((item for item in candidates if item and (item / "engine" / "__init__.py").exists()), None)
    if not root:
        raise RuntimeError("Insane Search skill root를 찾지 못했습니다. INSANE_SEARCH_ROOT를 지정하세요.")
    sys.path.insert(0, str(root))
    from engine import fetch  # type: ignore

    return fetch, root


def fetch_search_page(fetch: Any, spec: QuerySpec) -> dict[str, Any]:
    url = f"https://search.naver.com/search.naver?where=post&query={quote(spec.query)}"
    collected_at = now_iso()
    result = fetch(
        url,
        success_selectors=["a[href*='blog.naver.com']"],
        device_class="desktop",
        timeout=30,
        enable_learning=False,
        enable_markdown=False,
    )
    rows = parse_search_results(result.content or "", spec, collected_at) if result.ok else []
    return {
        "query": spec.query,
        "query_group": spec.group,
        "query_order": spec.order,
        "search_url": url,
        "collected_at": collected_at,
        "ok": bool(result.ok),
        "verdict": result.verdict,
        "summary": result.summary,
        "final_url": result.final_url,
        "result_count": len(rows),
        "results": rows,
    }


def unique_preserve(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        value = clean_text(value)
        if value and value not in seen:
            seen.add(value)
            output.append(value)
    return output


def select_content_container(soup: BeautifulSoup) -> Any:
    for selector in (".se-main-container", "#postViewArea", ".post_ct", "article"):
        found = soup.select_one(selector)
        if found:
            return found
    return soup.body or soup


def paragraph_texts(container: Any) -> list[str]:
    selectors = (
        ".se-text-paragraph",
        ".se-module-text p",
        ".se-module-text",
        "#postViewArea p",
        ".post_ct p",
    )
    for selector in selectors:
        values = unique_preserve(node.get_text(" ", strip=True) for node in container.select(selector))
        values = [value for value in values if len(value) >= 2]
        if len(values) >= 3:
            return values
    fallback = unique_preserve(container.stripped_strings)
    return [value for value in fallback if 2 <= len(value) <= 2000]


def image_metrics(container: Any, body_chars: int) -> dict[str, Any]:
    urls: list[str] = []
    for image in container.select("img"):
        value = image.get("data-lazy-src") or image.get("data-src") or image.get("src") or ""
        value = str(value)
        if not value or value.startswith("data:"):
            continue
        if not re.search(r"blog|postfiles|pstatic|naver", value, re.I):
            continue
        if re.search(r"profile|icon|emoji|sticker|banner", value, re.I):
            continue
        urls.append(value.split("?")[0])
    image_count = len(unique_preserve(urls))

    events: list[str] = []
    text_before_first_image = 0
    running_chars = 0
    first_image_seen = False
    for component in container.select(".se-component"):
        classes = " ".join(component.get("class", []))
        if "se-image" in classes or component.select_one("img"):
            events.append("image")
            if not first_image_seen:
                text_before_first_image = running_chars
                first_image_seen = True
        elif "se-text" in classes or component.get_text(" ", strip=True):
            text = clean_text(component.get_text(" ", strip=True))
            if text:
                events.append("text")
                running_chars += len(text)
    alternations = sum(1 for left, right in zip(events, events[1:]) if left != right)
    captions = len(container.select(".se-caption, .se-module-image .se-caption, figcaption"))
    return {
        "count": image_count,
        "per_1000_chars": round(image_count * 1000 / max(1, body_chars), 2),
        "text_chars_before_first_image": text_before_first_image if first_image_seen else None,
        "component_event_count": len(events),
        "text_image_alternations": alternations,
        "interleaving_ratio": round(alternations / max(1, len(events) - 1), 3),
        "caption_count": captions,
        "has_collage": bool(container.select(".se-module-image-grid, .se-layout-collage, [class*='collage']")),
    }


def phrase_hits(text: str, patterns: dict[str, tuple[str, ...]]) -> dict[str, bool]:
    lowered = text.lower()
    return {name: any(token.lower() in lowered for token in tokens) for name, tokens in patterns.items()}


def ordered_structure(text: str, patterns: dict[str, tuple[str, ...]]) -> list[str]:
    lowered = text.lower()
    positions: list[tuple[int, str]] = []
    for name, tokens in patterns.items():
        hits = [lowered.find(token.lower()) for token in tokens if lowered.find(token.lower()) >= 0]
        if hits:
            positions.append((min(hits), name))
    return [name for _, name in sorted(positions)][:10]


def query_tokens(query: str) -> list[str]:
    stop = {"추천", "후기", "비교", "사용", "솔직", "장단점", "일정", "코스", "여행"}
    return [token for token in re.findall(r"[A-Za-z0-9가-힣]+", query) if len(token) >= 2 and token not in stop]


def title_metrics(title: str, query: str) -> dict[str, Any]:
    hits = phrase_hits(title, TITLE_PATTERNS)
    tokens = query_tokens(query)
    compact_title = re.sub(r"\s+", "", title.lower())
    matched = [token for token in tokens if re.sub(r"\s+", "", token.lower()) in compact_title]
    return {
        "length": len(title),
        "patterns": hits,
        "query_token_coverage": round(len(matched) / max(1, len(tokens)), 3),
        "matched_query_tokens": matched[:8],
        "has_separator": bool(re.search(r"[|｜:·,-]", title)),
        "has_question": "?" in title,
        "has_number": bool(re.search(r"\d", title)),
    }


def repeated_paragraph_ratio(paragraphs: list[str]) -> float:
    normalized = [re.sub(r"[^A-Za-z0-9가-힣]", "", value) for value in paragraphs if len(value) >= 20]
    if not normalized:
        return 0.0
    counts = Counter(normalized)
    repeated = sum(count - 1 for count in counts.values() if count > 1)
    return round(repeated / len(normalized), 3)


def quality_score(
    title: str,
    body_chars: int,
    paragraphs: list[str],
    headings: list[str],
    images: dict[str, Any],
    body: str,
) -> tuple[int, list[str], list[str]]:
    score = 40
    positives: list[str] = []
    risks: list[str] = []
    if body_chars >= 1200:
        score += 12
        positives.append("body_1200_plus")
    if body_chars >= 2000:
        score += 8
        positives.append("body_2000_plus")
    if len(paragraphs) >= 8:
        score += 8
        positives.append("paragraph_depth")
    if len(headings) >= 2:
        score += 8
        positives.append("section_structure")
    if images["count"] >= 5:
        score += 10
        positives.append("image_evidence")
    if images["count"] >= 10:
        score += 4
        positives.append("image_depth")
    if images["interleaving_ratio"] >= 0.25:
        score += 5
        positives.append("text_image_interleaving")
    repetition = repeated_paragraph_ratio(paragraphs)
    if repetition >= 0.2:
        score -= 18
        risks.append("paragraph_repetition")
    spam_count = sum(1 for marker in SPAM_MARKERS if marker.lower() in f"{title}\n{body}".lower())
    if spam_count:
        score -= min(30, spam_count * 10)
        risks.append("promotional_spam_language")
    if body_chars < MIN_BODY_CHARS:
        score -= 30
        risks.append("thin_body")
    if images["count"] <= 1:
        score -= 12
        risks.append("thin_image_evidence")
    return max(0, min(100, score)), positives, risks


def parse_post(html: str, search_row: dict[str, Any]) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    for node in soup.select("script, style, noscript"):
        node.decompose()
    container = select_content_container(soup)
    paragraphs = paragraph_texts(container)

    og_title_node = soup.select_one("meta[property='og:title']")
    og_title = clean_text(og_title_node.get("content", "") if og_title_node else "")
    title_node = container.select_one(".se-title-text, .pcol1, h1, h2")
    title = clean_text(title_node.get_text(" ", strip=True) if title_node else "") or og_title or search_row["title"]
    if title and paragraphs and paragraphs[0] == title:
        paragraphs = paragraphs[1:]
    body = "\n".join(paragraphs)
    body_chars = len(re.sub(r"\s+", "", body))
    sentence_lengths = [
        len(clean_text(value))
        for value in re.split(r"[.!?。！？]+|\n+", body)
        if len(clean_text(value)) >= 4
    ]
    heading_candidates = unique_preserve(
        node.get_text(" ", strip=True)
        for node in container.select(".se-module-text, .se-text-paragraph, h2, h3, h4, strong")
    )
    headings = [
        value
        for value in heading_candidates
        if 4 <= len(value) <= 55
        and not re.search(r"[.!?。！？]$", value)
        and len(value.split()) <= 12
    ][:12]
    images = image_metrics(container, body_chars)

    structure_patterns = dict(COMMON_STRUCTURE_PATTERNS)
    if search_row["category"] == "travel":
        structure_patterns.update(TRAVEL_STRUCTURE_PATTERNS)
    structure = phrase_hits(body, structure_patterns)
    tone = phrase_hits(f"{title}\n{body}", TONE_PATTERNS)
    title_info = title_metrics(title, search_row["query"])
    first_fifth = body[: max(1, len(body) // 5)]
    tokens = query_tokens(search_row["query"])
    early_tokens = [token for token in tokens if token.lower() in first_fifth.lower()]
    all_tokens = [token for token in tokens if token.lower() in body.lower()]
    score, positives, risks = quality_score(title, body_chars, paragraphs, headings, images, body)

    published_node = soup.select_one("meta[property='article:published_time'], meta[property='og:article:published_time']")
    published_at = clean_text(published_node.get("content", "") if published_node else "")
    polite_yo = len(re.findall(r"(?:요|네요|거든요|더라고요)(?:[.!?…]|\s|$)", body))
    formal_da = len(re.findall(r"(?:습니다|합니다|입니다|됩니다)(?:[.!?…]|\s|$)", body))

    return {
        "title": title,
        "published_at": published_at or search_row.get("published_hint", ""),
        "body_char_count": body_chars,
        "paragraph_count": len(paragraphs),
        "heading_count": len(headings),
        "headings": headings,
        "sentence_count": len(sentence_lengths),
        "median_sentence_length": round(statistics.median(sentence_lengths), 1) if sentence_lengths else 0,
        "short_sentence_ratio": round(sum(1 for value in sentence_lengths if value <= 45) / max(1, len(sentence_lengths)), 3),
        "median_paragraph_length": round(statistics.median([len(value) for value in paragraphs]), 1) if paragraphs else 0,
        "structure_patterns": structure,
        "section_sequence": ordered_structure(body, structure_patterns),
        "tone_patterns": tone,
        "tone_endings": {"polite_yo": polite_yo, "formal_da": formal_da},
        "title_metrics": title_info,
        "seo": {
            "query_tokens": tokens,
            "title_token_coverage": title_info["query_token_coverage"],
            "early_token_coverage": round(len(early_tokens) / max(1, len(tokens)), 3),
            "body_token_coverage": round(len(all_tokens) / max(1, len(tokens)), 3),
        },
        "image_metrics": images,
        "repeated_paragraph_ratio": repeated_paragraph_ratio(paragraphs),
        "quality_score": score,
        "quality_eligible": score >= 60,
        "positive_signals": positives,
        "risk_signals": risks,
    }


def fetch_post(fetch: Any, row: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    result = fetch(
        mobile_post_url(row["url"]),
        success_selectors=[".se-main-container", "#postViewArea", ".post_ct", "article"],
        device_class="mobile",
        timeout=35,
        enable_learning=False,
        enable_markdown=False,
    )
    base = {
        **row,
        "fetch": {
            "ok": bool(result.ok),
            "verdict": result.verdict,
            "summary": result.summary,
            "final_url": result.final_url,
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "collected_at": now_iso(),
        },
    }
    if not result.ok:
        return {**base, "valid": False, "failure": "insane_search_fetch_failed"}
    parsed = parse_post(result.content or "", row)
    valid = bool(parsed["title"] and parsed["body_char_count"] >= MIN_BODY_CHARS)
    return {
        **base,
        "valid": valid,
        "failure": None if valid else "parsed_body_too_thin",
        "analysis": parsed,
    }


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = (len(ordered) - 1) * ratio
    lower = int(index)
    upper = min(len(ordered) - 1, lower + 1)
    weight = index - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight, 2)


def prevalence(rows: list[dict[str, Any]], path: str) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for row in rows:
        current: Any = row
        for part in path.split("."):
            current = current.get(part, {}) if isinstance(current, dict) else {}
        if isinstance(current, dict):
            for key, value in current.items():
                if value is True:
                    counts[key] += 1
    return [
        {"pattern": key, "count": count, "percent": round(count * 100 / max(1, len(rows)), 1)}
        for key, count in counts.most_common()
    ]


def aggregate(category: str, rows: list[dict[str, Any]], query_runs: list[dict[str, Any]]) -> dict[str, Any]:
    valid = [row for row in rows if row.get("valid")]
    eligible = [row for row in valid if row["analysis"]["quality_eligible"]]
    rank_one = [row for row in eligible if row["best_rank"] == 1]
    body_chars = [row["analysis"]["body_char_count"] for row in eligible]
    image_counts = [row["analysis"]["image_metrics"]["count"] for row in eligible]
    sentence_lengths = [row["analysis"]["median_sentence_length"] for row in eligible]
    paragraph_lengths = [row["analysis"]["median_paragraph_length"] for row in eligible]
    title_lengths = [row["analysis"]["title_metrics"]["length"] for row in eligible]
    sequence_counts = Counter(
        " > ".join(row["analysis"]["section_sequence"][:7])
        for row in eligible
        if len(row["analysis"]["section_sequence"]) >= 3
    )
    group_counts: dict[str, dict[str, Any]] = {}
    for group in sorted({row["query_group"] for row in valid}):
        subset = [row for row in valid if row["query_group"] == group]
        group_counts[group] = {
            "posts": len(subset),
            "eligible": sum(1 for row in subset if row["analysis"]["quality_eligible"]),
            "median_body_chars": percentile([row["analysis"]["body_char_count"] for row in subset], 0.5),
            "median_images": percentile([row["analysis"]["image_metrics"]["count"] for row in subset], 0.5),
        }
    return {
        "category": category,
        "generated_at": now_iso(),
        "method": {
            "ranking_definition": "Naver blog-tab non-personalized server session, query rank 1-6 at collection time",
            "causality_warning": "Observed co-occurrence in currently ranked posts; not proof that a pattern caused ranking.",
            "copyright_policy": "No full post body persisted; only provenance, short search snippets, short headings, and derived metrics.",
            "quality_threshold": 60,
        },
        "counts": {
            "queries": len(query_runs),
            "successful_queries": sum(1 for item in query_runs if item["ok"]),
            "candidate_urls": len(rows),
            "valid_posts": len(valid),
            "quality_eligible_posts": len(eligible),
            "rank_one_quality_posts": len(rank_one),
        },
        "distribution": {
            "body_chars": {"p25": percentile(body_chars, 0.25), "median": percentile(body_chars, 0.5), "p75": percentile(body_chars, 0.75)},
            "images": {"p25": percentile(image_counts, 0.25), "median": percentile(image_counts, 0.5), "p75": percentile(image_counts, 0.75)},
            "title_length": {"p25": percentile(title_lengths, 0.25), "median": percentile(title_lengths, 0.5), "p75": percentile(title_lengths, 0.75)},
            "median_sentence_length": {"p25": percentile(sentence_lengths, 0.25), "median": percentile(sentence_lengths, 0.5), "p75": percentile(sentence_lengths, 0.75)},
            "median_paragraph_length": {"p25": percentile(paragraph_lengths, 0.25), "median": percentile(paragraph_lengths, 0.5), "p75": percentile(paragraph_lengths, 0.75)},
        },
        "structure_prevalence": prevalence(eligible, "analysis.structure_patterns"),
        "tone_prevalence": prevalence(eligible, "analysis.tone_patterns"),
        "title_prevalence": prevalence(eligible, "analysis.title_metrics.patterns"),
        "rank_one_structure_prevalence": prevalence(rank_one, "analysis.structure_patterns"),
        "common_sequences": [
            {"sequence": key, "count": count, "percent": round(count * 100 / max(1, len(eligible)), 1)}
            for key, count in sequence_counts.most_common(12)
        ],
        "query_groups": group_counts,
        "risk_signal_counts": dict(Counter(signal for row in valid for signal in row["analysis"]["risk_signals"])),
    }


def report_markdown(summary: dict[str, Any]) -> str:
    category_label = "쇼핑" if summary["category"] == "shopping" else "여행"
    counts = summary["counts"]
    distribution = summary["distribution"]

    def rows(items: list[dict[str, Any]], limit: int = 14) -> str:
        return "\n".join(
            f"| {item['pattern']} | {item['count']} | {item['percent']}% |"
            for item in items[:limit]
        )

    sequence_rows = "\n".join(
        f"| {item['sequence']} | {item['count']} | {item['percent']}% |"
        for item in summary["common_sequences"][:10]
    ) or "| 충분한 반복 시퀀스 없음 | 0 | 0% |"
    return f"""# 네이버 {category_label} 상위노출 포스팅 관측 보고서

- 생성 시각: {summary['generated_at']}
- 검색 기준: {summary['method']['ranking_definition']}
- 검색어: {counts['queries']}개 ({counts['successful_queries']}개 성공)
- 유효 상위노출 포스트: {counts['valid_posts']}건
- 품질 분석 표본: {counts['quality_eligible_posts']}건
- 1위 품질 표본: {counts['rank_one_quality_posts']}건

> 이 결과는 현재 상위노출 글에서 함께 관찰된 패턴입니다. 특정 패턴이 순위를 만들었다는 인과 증거가 아닙니다.

## 분량과 이미지

| 지표 | P25 | 중앙값 | P75 |
| --- | ---: | ---: | ---: |
| 본문 글자수 | {distribution['body_chars']['p25']} | {distribution['body_chars']['median']} | {distribution['body_chars']['p75']} |
| 이미지 수 | {distribution['images']['p25']} | {distribution['images']['median']} | {distribution['images']['p75']} |
| 제목 길이 | {distribution['title_length']['p25']} | {distribution['title_length']['median']} | {distribution['title_length']['p75']} |
| 문장 길이 중앙값 | {distribution['median_sentence_length']['p25']} | {distribution['median_sentence_length']['median']} | {distribution['median_sentence_length']['p75']} |
| 문단 길이 중앙값 | {distribution['median_paragraph_length']['p25']} | {distribution['median_paragraph_length']['median']} | {distribution['median_paragraph_length']['p75']} |

## 구성 패턴

| 패턴 | 건수 | 비율 |
| --- | ---: | ---: |
{rows(summary['structure_prevalence'])}

## 문체 패턴

| 패턴 | 건수 | 비율 |
| --- | ---: | ---: |
{rows(summary['tone_prevalence'])}

## 제목 패턴

| 패턴 | 건수 | 비율 |
| --- | ---: | ---: |
{rows(summary['title_prevalence'])}

## 반복 관찰된 전개 순서

| 순서 | 건수 | 비율 |
| --- | ---: | ---: |
{sequence_rows}

## 해석 원칙

- 순위, 검색어, URL, 수집시각, Insane Search 판정을 `source-ledger.jsonl`에 보존합니다.
- 원문 전체를 저장하지 않습니다. 검색 스니펫과 짧은 소제목, 파생 지표만 남깁니다.
- 자동홍보형·반복형 글도 상위노출 관측에는 포함하되, 품질 기준 미달이면 권장 하네스 근거에서 제외합니다.
- 숫자는 글을 강제로 복제할 규칙이 아니라 AI가 독자 기대와 정보 밀도를 판단하는 참고 분포입니다.
"""


def merge_candidates(query_runs: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for run in query_runs:
        for row in run["results"][:RESULTS_PER_QUERY]:
            exposure = {
                "query": row["query"],
                "query_group": row["query_group"],
                "rank": row["rank"],
                "search_collected_at": row["search_collected_at"],
            }
            existing = merged.get(row["url"])
            if existing:
                existing["exposures"].append(exposure)
                if row["rank"] < existing["best_rank"]:
                    existing.update({key: value for key, value in row.items() if key not in {"rank"}})
                    existing["best_rank"] = row["rank"]
                continue
            merged[row["url"]] = {
                **row,
                "category": category,
                "best_rank": row["rank"],
                "exposures": [exposure],
            }
    return sorted(
        merged.values(),
        key=lambda row: (row["best_rank"], row["query_order"], row["url"]),
    )


def load_jsonl(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    rows: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("url"):
            rows[row["url"]] = row
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def sanitize_persisted_row(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize cached/search markup before it reaches the durable source ledger."""
    row["title"] = clean_markup(str(row.get("title", "")))
    row["snippet"] = clean_markup(str(row.get("snippet", "")))
    row["published_hint"] = clean_markup(str(row.get("published_hint", "")))
    row["blog_name"] = clean_markup(str(row.get("blog_name", "")))
    analysis = row.get("analysis")
    if isinstance(analysis, dict):
        analysis["title"] = clean_markup(str(analysis.get("title", "")))
        published_at = clean_markup(str(analysis.get("published_at", "")))
        analysis["published_at"] = published_at if re.search(
            r"(?:\d{4}\s*[-./년]\s*\d{1,2}|\d+\s*(?:분|시간|일|주|개월|년)\s*전|방금)",
            published_at,
        ) else ""
        analysis["headings"] = [
            clean_markup(str(value))
            for value in analysis.get("headings", [])
            if clean_markup(str(value))
        ]
    return row


def write_source_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "category", "query_group", "query", "best_rank", "url", "title",
                "body_char_count", "image_count", "heading_count", "quality_score",
                "quality_eligible", "fetch_verdict", "collected_at",
            ],
        )
        writer.writeheader()
        for row in rows:
            analysis = row.get("analysis", {})
            writer.writerow(
                {
                    "category": row["category"],
                    "query_group": row["query_group"],
                    "query": row["query"],
                    "best_rank": row["best_rank"],
                    "url": row["url"],
                    "title": analysis.get("title") or row.get("title", ""),
                    "body_char_count": analysis.get("body_char_count", 0),
                    "image_count": analysis.get("image_metrics", {}).get("count", 0),
                    "heading_count": analysis.get("heading_count", 0),
                    "quality_score": analysis.get("quality_score", 0),
                    "quality_eligible": analysis.get("quality_eligible", False),
                    "fetch_verdict": row.get("fetch", {}).get("verdict", ""),
                    "collected_at": row.get("fetch", {}).get("collected_at", ""),
                }
            )


def research_category(
    fetch: Any,
    category: str,
    query_pairs: list[tuple[str, str]],
    output_dir: Path,
    target: int,
    workers: int,
) -> dict[str, Any]:
    query_specs = [QuerySpec(group=group, query=query, order=index) for index, (group, query) in enumerate(query_pairs)]
    log(f"[{category}] 검색 결과 수집: {len(query_specs)}개 쿼리")
    query_runs: list[dict[str, Any]] = []
    for index, spec in enumerate(query_specs, start=1):
        run = fetch_search_page(fetch, spec)
        query_runs.append(run)
        log(f"[{category}] 검색 {index:02d}/{len(query_specs)} {run['result_count']}건 · {spec.query}")
        time.sleep(0.15)

    candidates = merge_candidates(query_runs, category)
    log(f"[{category}] 중복 제거 후보: {len(candidates)}건")
    cache_path = output_dir / "cache" / f"{category}-post-fetch.jsonl"
    cached = load_jsonl(cache_path)
    fetched: dict[str, dict[str, Any]] = dict(cached)
    pending = [row for row in candidates if row["url"] not in fetched]

    if pending:
        log(f"[{category}] Insane Search 본문 검증: 신규 {len(pending)}건, workers={workers}")
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            future_map = {executor.submit(fetch_post, fetch, row): row for row in pending}
            completed = 0
            for future in concurrent.futures.as_completed(future_map):
                row = future.result()
                fetched[row["url"]] = row
                completed += 1
                if completed % 10 == 0 or completed == len(pending):
                    valid_now = sum(1 for value in fetched.values() if value.get("valid"))
                    log(f"[{category}] 본문 {completed}/{len(pending)} · 누적 유효 {valid_now}")
                write_jsonl(cache_path, fetched.values())

    rows = [
        sanitize_persisted_row(fetched[row["url"]])
        for row in candidates
        if row["url"] in fetched
    ]
    write_jsonl(cache_path, fetched.values())
    valid_rows = [row for row in rows if row.get("valid")]
    if len(valid_rows) < target:
        raise RuntimeError(f"{category} 유효 표본이 {len(valid_rows)}건으로 목표 {target}건보다 적습니다.")

    summary = aggregate(category, rows, query_runs)
    category_dir = output_dir / category
    category_dir.mkdir(parents=True, exist_ok=True)
    (category_dir / "query-runs.json").write_text(json.dumps(query_runs, ensure_ascii=False, indent=2), encoding="utf-8")
    write_jsonl(category_dir / "source-ledger.jsonl", valid_rows)
    write_jsonl(category_dir / "fetch-failures.jsonl", [row for row in rows if not row.get("valid")])
    write_source_csv(category_dir / "source-summary.csv", valid_rows)
    (category_dir / "analysis.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (category_dir / "analysis.md").write_text(report_markdown(summary), encoding="utf-8")
    manifest = {
        "schema": "naver-top-post-research/v1",
        "category": category,
        "generated_at": now_iso(),
        "target_minimum": target,
        "counts": summary["counts"],
        "insane_search_required": True,
        "ranking_definition": summary["method"]["ranking_definition"],
        "files": {
            "source_ledger": "source-ledger.jsonl",
            "source_summary": "source-summary.csv",
            "analysis": "analysis.json",
            "report": "analysis.md",
            "query_runs": "query-runs.json",
        },
        "sha256": {},
    }
    for name, relative in manifest["files"].items():
        file_path = category_dir / relative
        manifest["sha256"][name] = hashlib.sha256(file_path.read_bytes()).hexdigest()
    (category_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", choices=("shopping", "travel", "all"), default="all")
    parser.add_argument("--target", type=int, default=105)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fetch, insane_root = load_insane_search()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    log(f"Insane Search root: {insane_root}")
    log(f"Output: {args.output_dir.resolve()}")
    summaries: dict[str, Any] = {}
    if args.category in {"shopping", "all"}:
        summaries["shopping"] = research_category(
            fetch, "shopping", SHOPPING_QUERIES, args.output_dir, args.target, args.workers
        )
    if args.category in {"travel", "all"}:
        summaries["travel"] = research_category(
            fetch, "travel", TRAVEL_QUERIES, args.output_dir, args.target, args.workers
        )
    summary_path = args.output_dir / "research-summary.json"
    previous: dict[str, Any] = {}
    if summary_path.exists():
        try:
            previous = json.loads(summary_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous = {}
    previous.update(summaries)
    summary_path.write_text(json.dumps(previous, ensure_ascii=False, indent=2), encoding="utf-8")
    log(json.dumps({key: value["counts"] for key, value in summaries.items()}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
