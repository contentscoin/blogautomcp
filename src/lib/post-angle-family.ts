import { readBrandPostPackage } from "./brand-post-package";
import {
  DEFAULT_POST_ANGLE,
  getPostAngle,
  isPostAngleId,
  suggestPostAngles,
  type PostAngleSuggestion,
  type SiblingPostSummary,
} from "../../scripts/lib/topic-templates/angles";

type BrandLinkRow = {
  id: string;
  url: string;
  connectKind: string;
  status: string;
  postUrl: string | null;
  productName: string | null;
  productDescription: string | null;
  productFeatures: string | null;
  parentBrandLinkId: string | null;
  postAngle: string | null;
};

/** 앱(생성 클라이언트)과 에이전트(@prisma/client) 양쪽에서 쓰도록 필요한 메서드만 요구한다. */
type FamilyClient = {
  brandLink: {
    findUnique(args: { where: { id: string }; select: typeof FAMILY_SELECT }): Promise<BrandLinkRow | null>;
    findMany(args: { where: { parentBrandLinkId: string }; orderBy: { createdAt: "asc" }; select: typeof FAMILY_SELECT }): Promise<BrandLinkRow[]>;
  };
};

export type ConnectKind = "SHOPPING" | "TRAVEL";

export function storedConnectKind(value: string | null | undefined): ConnectKind {
  return value === "TRAVEL" ? "TRAVEL" : "SHOPPING";
}

export function parseProductFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const FAMILY_SELECT = {
  id: true, url: true, connectKind: true, status: true, postUrl: true, productName: true,
  productDescription: true, productFeatures: true, parentBrandLinkId: true, postAngle: true,
} as const;

/** 원본 행과 주제 글(자식 행)을 모은다. 자식 행으로 조회해도 같은 가족을 돌려준다. */
export async function loadPostAngleFamily(db: FamilyClient, linkId: string): Promise<{ root: BrandLinkRow; members: BrandLinkRow[] } | null> {
  const link = await db.brandLink.findUnique({ where: { id: linkId }, select: FAMILY_SELECT });
  if (!link) return null;
  const rootId = link.parentBrandLinkId || link.id;
  const root = link.parentBrandLinkId
    ? (await db.brandLink.findUnique({ where: { id: rootId }, select: FAMILY_SELECT })) ?? link
    : link;
  const children = await db.brandLink.findMany({
    where: { parentBrandLinkId: rootId },
    orderBy: { createdAt: "asc" },
    select: FAMILY_SELECT,
  });
  const members = [root, ...children.filter((child) => child.id !== root.id)];
  return { root, members };
}

export function memberAngle(member: Pick<BrandLinkRow, "postAngle">): string {
  return member.postAngle || DEFAULT_POST_ANGLE;
}

/** 준비된 원고 패키지에서 형제 글 요약(제목·소제목·본문)을 읽는다. 원고가 없으면 각도만 남긴다. */
export function readSiblingSummary(member: BrandLinkRow): SiblingPostSummary & { id: string; postUrl: string | null } {
  let title: string | null = null;
  let headings: string[] = [];
  let sections: string[] = [];
  try {
    const manifest = readBrandPostPackage(member.id, { migrate: false });
    if (manifest) {
      title = manifest.title || null;
      if (manifest.version === "brand-post-package/v2") {
        headings = manifest.composition.sections.map((section) => section.title).filter(Boolean);
        sections = manifest.composition.sections.map((section) => [section.title, ...section.body].join("\n"));
      }
    }
  } catch {
    // A malformed sibling package must not block drafting this post.
  }
  return { id: member.id, angle: memberAngle(member), title, headings, sections, postUrl: member.postUrl };
}

export function siblingSummaries(members: readonly BrandLinkRow[], selfId: string) {
  return members.filter((member) => member.id !== selfId).map(readSiblingSummary);
}

export interface PostAngleFamilyView {
  rootId: string;
  connectKind: ConnectKind;
  members: Array<{ id: string; angle: string; label: string; status: string; postUrl: string | null; isRoot: boolean }>;
  suggestions: PostAngleSuggestion[];
}

export function buildPostAngleFamilyView(
  family: { root: BrandLinkRow; members: BrandLinkRow[] },
  options: { hasExperienceNotes?: boolean } = {},
): PostAngleFamilyView {
  const kind = storedConnectKind(family.root.connectKind);
  const existing = family.members.map(memberAngle);
  return {
    rootId: family.root.id,
    connectKind: kind,
    members: family.members.map((member) => ({
      id: member.id,
      angle: memberAngle(member),
      label: getPostAngle(kind, memberAngle(member)).label,
      status: member.status,
      postUrl: member.postUrl,
      isRoot: member.id === family.root.id,
    })),
    suggestions: suggestPostAngles({
      kind,
      productName: family.root.productName || "",
      description: family.root.productDescription,
      features: parseProductFeatures(family.root.productFeatures),
      hasExperienceNotes: options.hasExperienceNotes,
    }, existing),
  };
}

export function validateNewAngle(kind: ConnectKind, angle: unknown, view: PostAngleFamilyView): { ok: true; angle: string } | { ok: false; status: number; error: string } {
  if (!isPostAngleId(kind, angle)) return { ok: false, status: 400, error: "지원하지 않는 포스팅 주제입니다." };
  if (angle === DEFAULT_POST_ANGLE) return { ok: false, status: 400, error: "전체 리뷰는 원본 상품 글입니다." };
  const suggestion = view.suggestions.find((item) => item.id === angle);
  if (suggestion?.existing) return { ok: false, status: 409, error: "이미 같은 주제의 글이 있습니다." };
  if (!suggestion?.available) return { ok: false, status: 422, error: `근거가 부족해 이 주제로 쓸 수 없습니다: ${suggestion?.reason || "근거 없음"}` };
  return { ok: true, angle };
}
