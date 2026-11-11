import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentJobReadyCount, currentMaterialLabel } from "./material-job-display";
import { MaterialJobItemResult } from "../components/MaterialJobItemResult";

test("a product READY flag alone never displays approval readiness", () => {
  assert.equal(currentMaterialLabel({ productId: "p", status: "READY", ready: false }), "현재 보완 필요");
  assert.equal(currentJobReadyCount(["p"], [{ productId: "p", status: "READY", ready: false }]), 0);
});

test("a saved summary describes the previous check rather than a new approval", () => {
  const label = currentMaterialLabel({ productId: "p", status: "READY", ready: true,
    verification: { mode: "saved-summary", contentCheckedAt: "2026-10-10T00:00:00Z" } });
  assert.equal(label, "저장된 검사 기준 준비완료 · 발행 전 재확인");
  assert.doesNotMatch(label!, /현재 준비완료|검증·승인 완료/);
});
test("restored material displays current approval while retaining prior failure under details", () => {
  const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, {
    title: "한우", item: { stage: "확인 필요", error: "old image ambiguity", errorCode: "IMAGE_OUTPUT_AMBIGUOUS" },
    current: { productId: "p", status: "READY", ready: true, blockers: [] },
  }));
  assert.match(html, /현재 준비완료/);
  assert.match(html, /<details[^>]*><summary/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /이후 복구 완료/);
  assert.match(html, /old image ambiguity/);
});
test("current readiness count ignores absent, blocked and publishing materials and duplicate ids", () => {
  assert.equal(currentJobReadyCount(["ready", "ready", "absent", "blocked", "publishing"], [
    { productId: "ready", status: "READY", ready: true },
    { productId: "blocked", status: "BLOCKED", ready: false },
    { productId: "publishing", status: "PUBLISHING", ready: false },
  ]), 1);
});
test("unknown publication outcome remains visible; missing snapshot retains historical result", () => {
  assert.equal(currentMaterialLabel({ productId: "p", status: "OUTCOME_UNKNOWN", ready: false }), "현재 발행 결과 확인 필요");
  assert.equal(currentMaterialLabel(), null);
  const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, { title: "상품", item: { stage: "중단됨", error: "uncertain" } }));
  assert.match(html, /중단됨/);
  assert.doesNotMatch(html, /복구 완료|현재 준비완료/);
});
test("current blockers and old errors share closed native failure details", () => {
  const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, {
    title: "상품", item: { stage: "검증 실패", error: "예전 이미지 오류", errorCode: "IMAGE_ERROR" },
    current: { productId: "p", status: "BLOCKED", ready: false, blockers: ["현재 제목 상품명 누락"] },
  }));
  assert.match(html, /상품 — 현재 보완 필요/);
  assert.match(html, /<details[^>]*><summary[^>]*>실패 상세 보기<\/summary>[\s\S]*현재 제목 상품명 누락[\s\S]*예전 이미지 오류[\s\S]*<\/details>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.doesNotMatch(html.slice(0, html.indexOf("<details")), /IMAGE_ERROR|현재 제목 상품명 누락|예전 이미지 오류/);
});
test("a current blocker without any old error still provides closed details", () => {
  const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, {
    title: "상품", item: { stage: "진행 중" },
    current: { productId: "p", status: "BLOCKED", ready: false, blockers: ["품질 검증 필요"] },
  }));
  assert.match(html, /<details[^>]*><summary[^>]*>실패 상세 보기<\/summary>[\s\S]*품질 검증 필요/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/);
});

test("current recovery guidance stays inside collapsed failure details", () => {
  const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, {
    title: "상품", item: { stage: "예전 실패" },
    current: { productId: "p", status: "BLOCKED", ready: false, blockers: ["사진 검토 필요"],
      preparationDiagnostics: { nextAction: { instruction: "이전 요청 결과를 먼저 확인하세요." } } },
  }));
  assert.match(html, /<details[^>]*><summary[\s\S]*다음 조치: 이전 요청 결과를 먼저 확인하세요\./u);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/u);
  assert.doesNotMatch(html.slice(0, html.indexOf("<details")), /다음 조치/u);
});

test("ready material does not make a failed publication look recovered", () => {
  for (const supplied of [{ jobKind: "publish", item: { stage: "네이버 발행 실패", error: "입력 실패" } },
    { item: { stage: "발행 실패", errorCode: "PUBLISH_FAILED", error: "본문 입력 오류" } },
    { item: { stage: "확인 필요", error: "EDITOR_BODY_SCOPE: 본문 입력 영역을 찾지 못했습니다." } }]) {
    const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, { title: "한우", ...supplied,
      current: { productId: "p", status: "READY", ready: true, verification: { mode: "saved-summary" } } }));
    assert.match(html, /저장된 검사 기준 소재 준비완료 · 발행 재시도 필요/);
    assert.doesNotMatch(html, /이후 복구 완료/);
    assert.match(html, /실패 상세 보기/);
    assert.match(html, /이 작업 당시/);
  }
});

test("only an actual published or scheduled result resolves an earlier publication failure", () => {
  for (const status of ["PUBLISHED", "SCHEDULED"]) {
    const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, {
      title: "한우", jobKind: "publish", item: { stage: "이전 발행 실패", error: "PUBLISH_FAILED" },
      current: { productId: "p", status, ready: false } }));
    assert.match(html, /이후 복구 완료/); assert.doesNotMatch(html, /발행 재시도 필요/);
  }
});

test("uncertain publication outcomes never invite retries even when material is ready", () => {
  for (const value of [
    { status: "OUTCOME_UNKNOWN", item: { stage: "결과 확인", error: "응답 유실" } },
    { status: "READY", item: { stage: "결과 확인", status: "outcome_unknown", errorCode: "OUTCOME_UNKNOWN" } },
  ]) {
    const html = renderToStaticMarkup(React.createElement(MaterialJobItemResult, { title: "한우", jobKind: "publish", item: value.item,
      current: { productId: "p", status: value.status, ready: true } }));
    assert.match(html, /현재 발행 결과 확인 필요/); assert.doesNotMatch(html, /발행 재시도 필요|이후 복구 완료/);
  }
});
