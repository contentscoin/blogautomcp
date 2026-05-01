export type PreparedTopicSectionKind =
  | "hook"
  | "scene"
  | "mistake"
  | "comparison"
  | "proof"
  | "takeaway";

export interface PreparedTopicSection {
  heading: string;
  body: string;
  kind?: PreparedTopicSectionKind;
  summary?: string;
  bullets?: string[];
  stockQuery: string | null;
  sourceRefIds: string[];
  imageSlotId?: string | null;
}

export interface PreparedTopicMeta {
  summary: string;
  tone: string;
  selectedReason: string;
}

export interface PreparedTopicContent {
  title: string;
  lead?: string;
  highlights?: string[];
  sections: PreparedTopicSection[];
  hashtags: string[];
  meta: PreparedTopicMeta;
}

export interface TopicVisualPlanItem {
  query: string;
  preferredSource: string | null;
  fallbackToAi: boolean;
  sourceRefIds: string[];
  slotId?: string | null;
  sectionIndex?: number | null;
  role?: "hero" | "proof" | "scene" | "diagram" | "inline";
  strategy?: "source" | "stock" | "generate" | "none";
  visualIntent?: "real-scene" | "editorial" | "ui-screenshot" | "concept" | "comparison";
  subject?: string | null;
  scene?: string | null;
  why?: string | null;
  altQueries?: string[];
  confidence?: number | null;
}

export interface TopicVisualPlan {
  hero: TopicVisualPlanItem | null;
  inline: TopicVisualPlanItem[];
}

export interface StoredTopicPostPayload {
  title: string;
  lead?: string;
  highlights?: string[];
  sections: PreparedTopicSection[];
  hashtags: string[];
  meta?: PreparedTopicMeta;
}

type UnknownRecord = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
}

function normalizeSection(value: unknown): PreparedTopicSection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as UnknownRecord;
  const heading = normalizeText(record.heading ?? record.sectionTitle);
  const body = normalizeText(record.body ?? record.content);

  if (!heading && !body) {
    return null;
  }

  return {
    heading,
    body,
    kind:
      normalizeText(record.kind) === "hook" ||
      normalizeText(record.kind) === "scene" ||
      normalizeText(record.kind) === "mistake" ||
      normalizeText(record.kind) === "comparison" ||
      normalizeText(record.kind) === "proof" ||
      normalizeText(record.kind) === "takeaway"
        ? (normalizeText(record.kind) as PreparedTopicSectionKind)
        : undefined,
    summary: normalizeText(record.summary),
    bullets: parseStringArray(record.bullets),
    stockQuery: normalizeText(record.stockQuery) || null,
    sourceRefIds: parseStringArray(record.sourceRefIds),
    imageSlotId: normalizeText(record.imageSlotId) || null,
  };
}

function normalizeSections(value: unknown): PreparedTopicSection[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSection(item))
      .filter((item): item is PreparedTopicSection => item !== null);
  }

  if (typeof value === "string") {
    return value
      .split(/\n{2,}/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => ({
        heading: index === 0 ? "핵심 정리" : "",
        body: entry,
        summary: "",
        bullets: [],
        stockQuery: null,
        sourceRefIds: [],
      }));
  }

  return [];
}

function normalizeMeta(value: unknown): PreparedTopicMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      summary: "",
      tone: "",
      selectedReason: "",
    };
  }

  const record = value as UnknownRecord;
  return {
    summary: normalizeText(record.summary),
    tone: normalizeText(record.tone),
    selectedReason: normalizeText(record.selectedReason),
  };
}

function parseJsonRecord(raw: string | null): UnknownRecord | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as UnknownRecord;
  } catch {
    return null;
  }
}

export function parsePreparedTopicContent(raw: string | null): PreparedTopicContent | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;

  const title = normalizeText(parsed.title);
  const lead = normalizeText(parsed.lead);
  const highlights = parseStringArray(parsed.highlights);
  const sections = normalizeSections(parsed.sections);
  const hashtags = parseStringArray(parsed.hashtags);
  const meta = normalizeMeta(parsed.meta);

  if (!title && sections.length === 0 && hashtags.length === 0) {
    return null;
  }

  return {
    title,
    lead,
    highlights,
    sections,
    hashtags,
    meta,
  };
}

export function parseStoredTopicPayload(raw: string | null): StoredTopicPostPayload | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;

  const title = normalizeText(parsed.title);
  const lead = normalizeText(parsed.lead);
  const highlights = parseStringArray(parsed.highlights);
  const sections = normalizeSections(parsed.sections);
  const hashtags = parseStringArray(parsed.hashtags);

  if (!title && sections.length === 0 && hashtags.length === 0) {
    return null;
  }

  return {
    title,
    lead,
    highlights,
    sections,
    hashtags,
    meta: normalizeMeta(parsed.meta),
  };
}

export function serializePreparedTopicContent(content: PreparedTopicContent): string {
  return JSON.stringify(content);
}

export function serializeStoredTopicPayload(payload: StoredTopicPostPayload): string {
  return JSON.stringify(payload);
}

export function renderTopicContentToHtml(content: PreparedTopicContent | StoredTopicPostPayload): string {
  const title = normalizeText(content.title);
  const lead = normalizeText(content.lead);
  const highlights = parseStringArray(content.highlights);
  const sections = Array.isArray(content.sections) ? content.sections : [];
  const leadHtml = lead
    ? lead
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")
    : "";
  const highlightHtml =
    highlights.length > 0
      ? `<ul>${highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";
  const bodyHtml = sections
    .map((section) => {
      const heading = normalizeText(section.heading);
      const summary = normalizeText(section.summary);
      const body = normalizeText(section.body)
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
      const bullets = parseStringArray(section.bullets);
      const bulletHtml =
        bullets.length > 0
          ? `<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : "";

      return `${heading ? `<h2>${escapeHtml(heading)}</h2><hr />` : ""}${
        summary ? `<p><strong>${escapeHtml(summary)}</strong></p>` : ""
      }${body}${bulletHtml}`;
    })
    .join("");

  const tags =
    content.hashtags.length > 0
      ? `<p>${content.hashtags
          .map((tag) => `#${escapeHtml(tag.replace(/^#/, ""))}`)
          .join(" ")}</p>`
      : "";

  return `${title ? `<h1>${escapeHtml(title)}</h1>` : ""}${leadHtml}${highlightHtml}${bodyHtml}${tags}`;
}

export function preparedSectionsToPublishBlocks(
  content: PreparedTopicContent | StoredTopicPostPayload,
): string[] {
  const prefixBlocks = [
    normalizeText(content.lead),
    parseStringArray(content.highlights).length > 0
      ? ["핵심 포인트", ...parseStringArray(content.highlights).map((item) => `- ${item}`)].join("\n")
      : "",
  ].filter(Boolean);

  return [
    ...prefixBlocks,
    ...content.sections
    .map((section) => {
      const heading = normalizeText(section.heading);
      const summary = normalizeText(section.summary);
      const body = normalizeText(section.body);
      const bullets = parseStringArray(section.bullets).map((item) => `- ${item}`);
      return [heading, summary, body, ...bullets].filter(Boolean).join("\n\n").trim();
    })
    .filter(Boolean),
  ];
}

export function parseTopicVisualPlan(raw: string | null): TopicVisualPlan | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;

  const normalizeItem = (value: unknown): TopicVisualPlanItem | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as UnknownRecord;
    const query = normalizeText(record.query);
    if (!query) return null;

    return {
      query,
      preferredSource: normalizeText(record.preferredSource) || null,
      fallbackToAi: Boolean(record.fallbackToAi),
      sourceRefIds: parseStringArray(record.sourceRefIds),
      slotId: normalizeText(record.slotId) || null,
      sectionIndex:
        typeof record.sectionIndex === "number" && Number.isInteger(record.sectionIndex)
          ? record.sectionIndex
          : null,
      role:
        normalizeText(record.role) === "hero" ||
        normalizeText(record.role) === "proof" ||
        normalizeText(record.role) === "scene" ||
        normalizeText(record.role) === "diagram" ||
        normalizeText(record.role) === "inline"
          ? (normalizeText(record.role) as TopicVisualPlanItem["role"])
          : undefined,
      strategy:
        normalizeText(record.strategy) === "source" ||
        normalizeText(record.strategy) === "stock" ||
        normalizeText(record.strategy) === "generate" ||
        normalizeText(record.strategy) === "none"
          ? (normalizeText(record.strategy) as TopicVisualPlanItem["strategy"])
          : undefined,
      visualIntent:
        normalizeText(record.visualIntent) === "real-scene" ||
        normalizeText(record.visualIntent) === "editorial" ||
        normalizeText(record.visualIntent) === "ui-screenshot" ||
        normalizeText(record.visualIntent) === "concept" ||
        normalizeText(record.visualIntent) === "comparison"
          ? (normalizeText(record.visualIntent) as TopicVisualPlanItem["visualIntent"])
          : undefined,
      subject: normalizeText(record.subject) || null,
      scene: normalizeText(record.scene) || null,
      why: normalizeText(record.why) || null,
      altQueries: parseStringArray(record.altQueries),
      confidence:
        typeof record.confidence === "number" && Number.isFinite(record.confidence)
          ? record.confidence
          : null,
    };
  };

  const hero = normalizeItem(parsed.hero);
  const inline = Array.isArray(parsed.inline)
    ? parsed.inline
        .map((item) => normalizeItem(item))
        .filter((item): item is TopicVisualPlanItem => item !== null)
    : [];

  return { hero, inline };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
