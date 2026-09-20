/**
 * 생성 → 비전 QC → 교정 재생성 루프. 최대 시도 안에 95점을 못 넘기면 null 을 돌려주고
 * 호출자가 로컬 합성으로 강등한다 (오탈자 썸네일을 그대로 내보내지 않기 위해).
 */

import fs from "fs";
import path from "path";
import { generateProductThumbnailViaImageApi } from "../openai-image";
import { buildCorrectivePrompt } from "./corrective";
import { qcThumbnail, type ThumbnailQcExpectation, type ThumbnailQcReport } from "./qc";

export interface ThumbnailAttempt {
  attempt: number;
  path: string | null;
  qc: ThumbnailQcReport | null;
  prompt: string;
}

export interface ThumbnailGenerationResult {
  path: string;
  qc: ThumbnailQcReport;
  attempts: number;
  history: ThumbnailAttempt[];
}

export interface GenerateThumbnailWithQcInput {
  prompt: string;
  referenceImagePath?: string | null;
  outputDir: string;
  fileLabel: string;
  expected: ThumbnailQcExpectation;
  maxAttempts?: number;
  size?: string;
  quality?: string;
  /** 테스트용 주입: 실제 API 대신 사용할 생성기/QC */
  deps?: {
    generate?: (prompt: string, attempt: number) => Promise<string | null>;
    qc?: (imagePath: string, attempt: number) => Promise<ThumbnailQcReport>;
  };
  onAttempt?: (attempt: ThumbnailAttempt) => void;
}

export function maxThumbnailAttempts(): number {
  const parsed = Number.parseInt(process.env.PRODUCT_THUMBNAIL_MAX_ATTEMPTS || "", 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 4;
}

export async function generateThumbnailWithQc(input: GenerateThumbnailWithQcInput): Promise<ThumbnailGenerationResult | null> {
  const maxAttempts = input.maxAttempts ?? maxThumbnailAttempts();
  const generate =
    input.deps?.generate ||
    ((prompt: string) =>
      generateProductThumbnailViaImageApi({
        prompt,
        referenceImagePath: input.referenceImagePath,
        outputDir: input.outputDir,
        fileLabel: input.fileLabel,
        size: input.size,
        quality: input.quality,
      }));
  const qc = input.deps?.qc || ((imagePath: string) => qcThumbnail(imagePath, input.expected));

  const history: ThumbnailAttempt[] = [];
  let prompt = input.prompt;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const generatedPath = await generate(prompt, attempt);
    if (!generatedPath) {
      const record: ThumbnailAttempt = { attempt, path: null, qc: null, prompt };
      history.push(record);
      input.onAttempt?.(record);
      // 생성 자체가 실패하면(모델 접근·네트워크) 반복해도 같은 결과일 가능성이 커 중단한다.
      break;
    }
    const report = await qc(generatedPath, attempt);
    const record: ThumbnailAttempt = { attempt, path: generatedPath, qc: report, prompt };
    history.push(record);
    input.onAttempt?.(record);
    // Regenerating cannot repair an unavailable judge, and must not spend more
    // image credits. Never accept a legacy unchecked/pass=true report either.
    if (!report.checked) break;
    if (report.pass) {
      try {
        fs.writeFileSync(
          path.join(path.dirname(generatedPath), `${path.basename(generatedPath, path.extname(generatedPath))}.qc.json`),
          JSON.stringify({ ...report, attempts: attempt, checkedAt: new Date().toISOString() }, null, 2),
          "utf8",
        );
      } catch {
        // QC 기록 실패는 무시
      }
      return { path: generatedPath, qc: report, attempts: attempt, history };
    }
    prompt = buildCorrectivePrompt(input.prompt, report, attempt + 1);
  }
  return null;
}
