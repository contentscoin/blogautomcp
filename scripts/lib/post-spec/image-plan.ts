/**
 * 이미지 플랜 — 글을 쓰기 *전에* 본문 이미지를 확정한다.
 *
 * 예전에는 섹션 수를 정하고 글을 다 쓴 뒤 업로드 단계에서 이미지를 4장으로 잘라내
 * "섹션 10개 vs 이미지 4장"이 됐다. 여기서는 후보를 먼저 점검·보강하고, 확보된 장수에서
 * 섹션 수를 파생하며, 슬롯마다 파일 경로까지 확정한 뒤에 생성을 시작한다.
 */

import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  isRepresentativeTravelImageDimension,
  isUsableBlogProductImageDimension,
} from "../product-image-selection";
import type { ConnectKind, ImageCandidateInput, ImagePlan, ImageSlot, ImageStrategy } from "./types";

export interface ProbedImage {
  path: string;
  kind: ImageCandidateInput["kind"];
  strategy: ImageStrategy;
  score: number;
  width: number;
  height: number;
  usable: boolean;
}

export interface ImagePool {
  hero: ProbedImage | null;
  body: ProbedImage[];
  /** 본문 기준 미달이지만 콜라주 재료로 쓸 수 있는 이미지 */
  spare: ProbedImage[];
  notes: string[];
}

export interface PrepareImagePoolInput {
  kind: ConnectKind;
  candidates: ImageCandidateInput[];
  minBody: number;
  targetBody: number;
  tempDir: string;
  stockKeywords?: string[];
}

const BAD_NAME = /banner|event|coupon|benefit|delivery|shipping|review|notice|guide/i;

async function probe(candidate: ImageCandidateInput, kind: ConnectKind): Promise<ProbedImage | null> {
  if (!candidate.path || !fs.existsSync(candidate.path)) return null;
  try {
    const metadata = await sharp(candidate.path).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const basename = path.basename(candidate.path).toLowerCase();
    const named = candidate.kind === "hero" || candidate.kind === "card" || !BAD_NAME.test(basename);
    const dims =
      candidate.kind === "card"
        ? width >= 600 && height >= 600
        : kind === "TRAVEL"
          ? isRepresentativeTravelImageDimension(width, height) || isUsableBlogProductImageDimension(width, height)
          : width >= 500 && height >= 500 && isUsableBlogProductImageDimension(width, height);
    const strategy: ImageStrategy =
      candidate.kind === "hero" ? "hero" : candidate.kind === "card" ? "card" : candidate.kind === "crop" ? "crop" : "source";
    return {
      path: candidate.path,
      kind: candidate.kind,
      strategy,
      score: candidate.score ?? 0,
      width,
      height,
      usable: named && dims,
    };
  } catch {
    return null;
  }
}

/** 남는 상세 이미지 2~4장을 1:1 한 장으로 합성한다 (쇼핑 보강 전략). */
export async function buildCollageImage(sources: string[], outputPath: string): Promise<string | null> {
  const inputs = sources.slice(0, 4);
  if (inputs.length < 2) return null;
  try {
    const size = 1080;
    const gap = 16;
    const cells =
      inputs.length === 2
        ? [
            { left: gap, top: gap, width: (size - gap * 3) / 2, height: size - gap * 2 },
            { left: gap * 2 + (size - gap * 3) / 2, top: gap, width: (size - gap * 3) / 2, height: size - gap * 2 },
          ]
        : [0, 1, 2, 3].slice(0, inputs.length).map((index) => ({
            left: gap + (index % 2) * ((size - gap * 3) / 2 + gap),
            top: gap + Math.floor(index / 2) * ((size - gap * 3) / 2 + gap),
            width: (size - gap * 3) / 2,
            height: (size - gap * 3) / 2,
          }));
    const composites = await Promise.all(
      inputs.map(async (source, index) => {
        const cell = cells[index];
        const buffer = await sharp(source)
          .resize(Math.round(cell.width), Math.round(cell.height), { fit: "contain", background: "#ffffff" })
          .jpeg({ quality: 90 })
          .toBuffer();
        return { input: buffer, left: Math.round(cell.left), top: Math.round(cell.top) };
      }),
    );
    await sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } })
      .composite(composites)
      .jpeg({ quality: 92 })
      .toFile(outputPath);
    return outputPath;
  } catch {
    return null;
  }
}

/** Unsplash API 로 여행지 사진을 내려받는다 (키가 있을 때만, 스크래핑 없음). */
export async function fetchStockImages(keywords: string[], count: number, outputDir: string): Promise<string[]> {
  const enabled = (process.env.TRAVEL_STOCK_IMAGES_ENABLED || "true").toLowerCase() !== "false";
  const accessKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!enabled || !accessKey || count <= 0) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    if (output.length >= count) break;
    try {
      const url = new URL("https://api.unsplash.com/search/photos");
      url.searchParams.set("query", keyword);
      url.searchParams.set("per_page", "6");
      url.searchParams.set("orientation", "landscape");
      url.searchParams.set("content_filter", "high");
      const response = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
      if (!response.ok) continue;
      const payload = (await response.json()) as { results?: Array<{ id?: string; urls?: { regular?: string } }> };
      for (const item of payload.results || []) {
        if (output.length >= count) break;
        const imageUrl = item.urls?.regular;
        const id = item.id || imageUrl;
        if (!imageUrl || !id || seen.has(id)) continue;
        seen.add(id);
        const download = await fetch(imageUrl);
        if (!download.ok) continue;
        fs.mkdirSync(outputDir, { recursive: true });
        const destination = path.join(outputDir, `stock_${Date.now()}_${output.length + 1}.jpg`);
        fs.writeFileSync(destination, Buffer.from(await download.arrayBuffer()));
        output.push(destination);
      }
    } catch {
      // 다음 키워드로 계속
    }
  }
  return output;
}

export async function prepareImagePool(input: PrepareImagePoolInput): Promise<ImagePool> {
  const notes: string[] = [];
  const seen = new Set<string>();
  const probed: ProbedImage[] = [];
  for (const candidate of input.candidates) {
    const resolved = path.resolve(candidate.path || "");
    if (!candidate.path || seen.has(resolved)) continue;
    seen.add(resolved);
    const image = await probe(candidate, input.kind);
    if (image) probed.push(image);
  }

  const heroCandidate = probed.find((image) => image.kind === "hero") ?? null;
  const usableBody = probed
    .filter((image) => image.usable && image.kind !== "hero")
    .sort((a, b) => {
      if (a.kind === "card" && b.kind !== "card") return -1;
      if (b.kind === "card" && a.kind !== "card") return 1;
      if (a.kind === "source" && b.kind === "crop") return -1;
      if (a.kind === "crop" && b.kind === "source") return 1;
      return b.score - a.score;
    });
  // 대표 이미지는 썸네일 재료이면서 본문 첫 상품컷으로도 쓰인다(샘플 글 관행).
  if (heroCandidate && heroCandidate.usable && !usableBody.some((image) => image.path === heroCandidate.path)) {
    usableBody.unshift({ ...heroCandidate, strategy: "source", kind: "source" });
  }
  const spare = probed.filter((image) => !image.usable && image.kind !== "hero" && image.width >= 300 && image.height >= 300);

  const body: ProbedImage[] = [...usableBody];
  const shortfall = Math.max(0, input.minBody - body.length);
  if (shortfall > 0) {
    if (input.kind === "TRAVEL") {
      const stock = await fetchStockImages(input.stockKeywords || [], shortfall, input.tempDir);
      for (const stockPath of stock) {
        body.push({ path: stockPath, kind: "source", strategy: "stock", score: -100, width: 0, height: 0, usable: true });
      }
      notes.push(stock.length > 0 ? `여행 스톡 이미지 ${stock.length}장 보강` : "여행 스톡 이미지 보강 불가(키 없음 또는 결과 없음)");
    } else {
      const material = [...spare, ...usableBody.filter((image) => image.kind === "crop")].map((image) => image.path);
      let built = 0;
      for (let index = 0; built < shortfall && material.length >= 2; index += 1) {
        const chunk = material.splice(0, Math.min(4, Math.max(2, material.length)));
        const output = path.join(input.tempDir, `collage_${Date.now()}_${index + 1}.jpg`);
        fs.mkdirSync(input.tempDir, { recursive: true });
        const collage = await buildCollageImage(chunk, output);
        if (collage) {
          body.push({ path: collage, kind: "source", strategy: "collage", score: -50, width: 1080, height: 1080, usable: true });
          built += 1;
        }
      }
      notes.push(built > 0 ? `상세 이미지 콜라주 ${built}장 보강` : "콜라주 보강 재료 부족");
    }
  }
  if (body.length < input.minBody) {
    notes.push(`본문 이미지 부족: 확보 ${body.length}장 / 최소 ${input.minBody}장`);
  }
  return { hero: heroCandidate, body: body.slice(0, Math.max(input.targetBody, input.minBody)), spare, notes };
}

export interface SlotSectionInput {
  index: number;
  imageCount: [number, number];
  imageIntent: string;
}

/** 확보된 이미지를 섹션 슬롯에 배정한다: 최소치 먼저, 남으면 최대치까지 순서대로. */
export function assignImageSlots(
  pool: ImagePool,
  sections: SlotSectionInput[],
  kind: ConnectKind,
  minBody: number,
  targetBody: number,
): ImagePlan {
  const queue = [...pool.body];
  const assigned = new Map<number, ProbedImage[]>();
  const takeFor = (section: SlotSectionInput) => {
    const next = queue.shift();
    if (!next) return false;
    const list = assigned.get(section.index) || [];
    list.push(next);
    assigned.set(section.index, list);
    return true;
  };
  // 카드는 일정 개요 섹션에 우선 배정한다.
  const cardIndex = queue.findIndex((image) => image.strategy === "card");
  const overviewSection = sections.find((section) => /일정|overview/u.test(section.imageIntent) || section.index === 2);
  if (cardIndex >= 0 && overviewSection && overviewSection.imageCount[1] > 0) {
    const [card] = queue.splice(cardIndex, 1);
    assigned.set(overviewSection.index, [card]);
  }
  for (const section of sections) {
    const have = assigned.get(section.index)?.length || 0;
    for (let n = have; n < section.imageCount[0]; n += 1) {
      if (!takeFor(section)) break;
    }
  }
  for (const section of sections) {
    const have = () => assigned.get(section.index)?.length || 0;
    while (have() < section.imageCount[1] && queue.length > 0) {
      if (!takeFor(section)) break;
    }
  }
  const slots: ImageSlot[] = [];
  for (const section of sections) {
    const images = assigned.get(section.index) || [];
    images.forEach((image, position) => {
      slots.push({
        id: `s${String(section.index).padStart(2, "0")}-${String.fromCharCode(97 + position)}`,
        sectionIndex: section.index,
        intent: section.imageIntent,
        strategy: image.strategy,
        path: image.path,
        score: image.score,
      });
    });
  }
  const hero: ImageSlot | null = pool.hero
    ? { id: "hero", sectionIndex: -1, intent: "대표 이미지(썸네일)", strategy: "hero", path: pool.hero.path, score: pool.hero.score }
    : null;
  const resolvedBody = slots.length;
  return {
    policy: kind === "SHOPPING" ? "LOCKED_PRODUCT_OR_ORIGINAL" : "TRAVEL_EDITORIAL",
    hero,
    slots,
    targetBody,
    resolvedBody,
    minBody,
    shortfall: Math.max(0, minBody - resolvedBody),
    shrinkApplied: resolvedBody < targetBody,
    notes: pool.notes,
  };
}
