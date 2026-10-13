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
