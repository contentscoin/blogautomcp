/**
 * STAGE C' — 타깃 수리. 문제가 있는 섹션만 다시 쓴다. 전체 재작성·상투문 패딩은 하지 않는다.
 */

import { generateStructured } from "./llm-client";
import { renderFactsBlock, renderSectionInstruction, renderSystemPrompt, renderTitleRules, type GenerateContext } from "./generate";
import { buildSingleSectionSchema, TITLE_ONLY_SCHEMA } from "./schema";
import type { GeneratedDraft, GeneratedSection, PostSpec, RepairTarget, ValidationReport } from "./types";

const UNREPAIRABLE = new Set(["IMAGE_SHORTFALL"]);

export function repairableTargets(report: ValidationReport): RepairTarget[] {
  return report.repair.targets.filter((target) => !UNREPAIRABLE.has(target.code) && target.priority !== "P2");
}

export async function repairDraft(spec: PostSpec, draft: GeneratedDraft, report: ValidationReport, ctx: GenerateContext): Promise<GeneratedDraft> {
  const targets = repairableTargets(report);
  if (targets.length === 0) return draft;
  const system = renderSystemPrompt(spec, ctx);
  const titleTargets = targets.filter((target) => target.sectionIndex === null);
  const bySection = new Map<number, RepairTarget[]>();
  for (const target of targets) {
    if (target.sectionIndex === null) continue;
    bySection.set(target.sectionIndex, [...(bySection.get(target.sectionIndex) || []), target]);
  }

  let title = draft.title;
  let attempts = draft.attempts;
  if (titleTargets.length > 0) {
    const result = await generateStructured<{ title?: string }>({
      system,
      user: [renderFactsBlock(spec), renderTitleRules(spec), "## 현재 제목", draft.title, "## 문제", ...titleTargets.map((t) => `- ${t.reason}: ${t.instruction}`), "## 출력", 'JSON 객체 {"title": "..."} 만.'].join("\n\n"),
      schema: TITLE_ONLY_SCHEMA,
      schemaName: "post_title",
      maxOutputTokens: 400,
      temperature: 0.6,
    });
    attempts += 1;
    if (typeof result.json.title === "string" && result.json.title.trim()) title = result.json.title.trim();
  }

  const sections: GeneratedSection[] = [];
  for (const section of draft.sections) {
    const sectionTargets = bySection.get(section.index);
    if (!sectionTargets) {
      sections.push(section);
      continue;
    }
    const spec$ = spec.sections[section.index];
    const neighbors = draft.sections
      .filter((other) => other.index !== section.index)
      .map((other) => `- ${other.title}: ${other.lines[0] || ""}`)
      .join("\n");
    try {
      const result = await generateStructured<{ section?: { lines?: unknown } }>({
        system,
        user: [
          renderFactsBlock(spec),
          "## 다시 쓸 섹션",
          renderSectionInstruction(spec$, spec),
          "## 현재 본문",
          section.lines.join("\n"),
          "## 고쳐야 할 점",
          ...sectionTargets.map((t) => `- ${t.reason}: ${t.instruction}`),
          "## 다른 섹션 (내용이 겹치지 않게)",
          neighbors,
          ctx.memo ? `## 요청 메모\n${ctx.memo}` : "",
          "## 출력",
          'JSON 객체 {"section": {"role": "...", "title": "...", "lines": ["..."]}} 만. 제목은 그대로.',
        ]
          .filter(Boolean)
          .join("\n\n"),
        schema: buildSingleSectionSchema(spec$),
        schemaName: `section_${section.index}`,
        maxOutputTokens: 1200,
        temperature: 0.6,
      });
      attempts += 1;
      const lines = Array.isArray(result.json.section?.lines)
        ? result.json.section!.lines.filter((line): line is string => typeof line === "string")
        : [];
      sections.push(lines.length > 0 ? { ...section, lines } : section);
    } catch {
      sections.push(section);
    }
  }

  return { ...draft, title, sections, attempts };
}
