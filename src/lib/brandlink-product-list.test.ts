import assert from "node:assert/strict";
import test from "node:test";
import { collapseBrandLinkProducts, getWritingStatus, matchesWritingStatusFilter } from "./brandlink-product-list";

const date = new Date("2026-01-01T00:00:00.000Z");

test("writing status separates an unprepared READY link from a prepared draft", () => {
  assert.equal(getWritingStatus({ status: "READY", draftPrepared: false }), "unwritten");
  assert.equal(getWritingStatus({ status: "READY", draftPrepared: true }), "drafted");
  assert.equal(getWritingStatus({ status: "SCHEDULED" }), "scheduled");
  assert.equal(getWritingStatus({ status: "PUBLISHED" }), "published");
  assert.equal(matchesWritingStatusFilter("drafted", "written"), true);
  assert.equal(matchesWritingStatusFilter("in_progress", "written"), false);
  assert.equal(matchesWritingStatusFilter("failed", "unwritten"), true);
});

test("duplicate collapse keeps the prepared record when lifecycle status is equal", () => {
  const rows = collapseBrandLinkProducts([
    { id: "old", connectKind: "SHOPPING", externalItemId: "item-1", url: "https://naver.me/a", status: "READY", errorMessage: null, createdAt: date, updatedAt: date, draftPrepared: false },
    { id: "prepared", connectKind: "SHOPPING", externalItemId: "item-1", url: "https://naver.me/a", status: "READY", errorMessage: null, createdAt: date, updatedAt: date, draftPrepared: true },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "prepared");
  assert.equal(rows[0].writingStatus, "drafted");
});
