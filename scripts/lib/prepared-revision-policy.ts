import type { BrandLinkContentReadiness } from "./brandlink-content-readiness";
import { selectQualityRepairSectionIndexes, type QualityConvergencePlan } from "./quality-convergence";

/** An empty body scope is valid only when the measured failure belongs to the title alone. */
export function isPreparedTitleOnlyRepair(input: {
  current: BrandLinkContentReadiness;
  plan: QualityConvergencePlan | null;
  qualityConvergence: boolean;
}): boolean {
  const { current, plan } = input;
  return input.qualityConvergence && plan?.action === "repair-text" &&
    plan.targets.length > 0 && plan.targets.every(target => target.key === "missing-product-name") &&
    current.code === "missing-product-name" &&
    current.blockers.length > 0 && current.blockers.every(blocker => blocker.code === "missing-product-name") &&
    current.signals.some(signal => signal.key === "product-title" && signal.status === "fail") &&
    current.signals.some(signal => signal.key === "product-body" && signal.status === "pass") &&
    current.signals.every(signal => signal.status !== "fail" || signal.key === "product-title") &&
    !current.qualityFailures?.length &&
    current.quality.categories.every(category => category.status !== "fail") &&
    current.quality.score >= current.quality.passScore;
}

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
