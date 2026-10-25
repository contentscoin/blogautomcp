import type { BrandPostPackageManifest } from "./brand-post-package";

/** Progress is telemetry, never evidence that a draft is approved or ready. */
export function brandPostImageProgress(state: BrandPostPackageManifest["imageGeneration"]) {
  if (!state) return null;
  return {
    status: state.status,
    requested: state.requested,
    applied: state.applied,
    remaining: state.remaining,
    errors: state.errors.slice(0, 24).map(error => error.slice(0, 1200)),
    updatedAt: state.updatedAt,
    ...(state.heartbeatAt ? { heartbeatAt: state.heartbeatAt } : {}),
    ...(state.recoveryState ? { recoveryState: state.recoveryState } : {}),
  };
}
