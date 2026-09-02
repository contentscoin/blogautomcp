/**
 * 스펙 → OpenAI structured output(json_schema, strict) 변환.
 * 섹션 수를 고정하기 위해 배열 대신 고정 키 객체(s00, s01, …)를 쓴다.
 * strict 모드는 minItems 같은 배열 길이 키워드를 지원하지 않기 때문이다.
 */

import type { PostSpec, SectionSpec } from "./types";

export function sectionKey(index: number): string {
  return `s${String(index).padStart(2, "0")}`;
}

function sectionSchema(section: SectionSpec) {
  return {
    type: "object",
    properties: {
      role: { type: "string", enum: [section.role] },
      title: { type: "string" },
      lines: { type: "array", items: { type: "string" } },
    },
    required: ["role", "title", "lines"],
    additionalProperties: false,
  };
}

export function buildDraftJsonSchema(spec: PostSpec, sectionIndexes: number[], includeMeta: boolean) {
  const sections = sectionIndexes.map((index) => spec.sections[index]);
  const sectionProperties: Record<string, unknown> = {};
  for (const section of sections) sectionProperties[sectionKey(section.index)] = sectionSchema(section);
  const properties: Record<string, unknown> = {
    sections: {
      type: "object",
      properties: sectionProperties,
      required: Object.keys(sectionProperties),
      additionalProperties: false,
    },
  };
  const required = ["sections"];
  if (includeMeta) {
    properties.title = { type: "string" };
    properties.hashtags = { type: "array", items: { type: "string" } };
    required.unshift("title", "hashtags");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function buildSingleSectionSchema(section: SectionSpec) {
  return {
    type: "object",
    properties: { section: sectionSchema(section) },
    required: ["section"],
    additionalProperties: false,
  };
}

export const TITLE_ONLY_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
};
