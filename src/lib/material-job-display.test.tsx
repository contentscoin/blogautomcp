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
