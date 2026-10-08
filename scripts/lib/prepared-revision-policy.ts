import type { BrandLinkContentReadiness } from "./brandlink-content-readiness";
import { selectQualityRepairSectionIndexes, type QualityConvergencePlan } from "./quality-convergence";

/** Shared by the actual writer and offline checks; repair cannot widen its scope to all body paragraphs. */
export function selectPreparedRevisionSectionIndexes(input: {
  current: BrandLinkContentReadiness;
  sections: string[];
  plan: QualityConvergencePlan | null;
  requestedIndexes: number[];
  qualityConvergence: boolean;
  incrementalOnly: boolean;
}): number[] {
  const bodyIndexes = input.sections.slice(0, -1).map((_, index) => index);
  const requestedIndexes = [...new Set(input.requestedIndexes)].filter(index => bodyIndexes.includes(index));
  if (input.incrementalOnly) {
    return selectQualityRepairSectionIndexes({ current: input.current, sections: input.sections, plan: input.plan,
      requestedIndexes, requireFailureLinkedTargets: true });
  }
  const failingCategoryCount = input.current.quality.categories.filter(category => category.status === "fail").length;
  const severe = input.qualityConvergence && requestedIndexes.length === 0 &&
    failingCategoryCount * 2 >= Math.max(1, input.current.quality.categories.length);
  return severe ? bodyIndexes : input.qualityConvergence
    ? selectQualityRepairSectionIndexes({ current: input.current, sections: input.sections, plan: input.plan, requestedIndexes })
    : requestedIndexes.length ? requestedIndexes : bodyIndexes;
}
