/** Public, bounded display data. No image paths, raw prompts or provider text. */
export type MaterialReviewWarning = {
  kind: "suspected-omission-uncorroborated" | "intrinsic-print-unverified";
  reason: string;
  nodeIndex: number;
  assetSha256: string;
};
