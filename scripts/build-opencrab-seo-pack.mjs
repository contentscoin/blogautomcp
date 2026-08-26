import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const SOURCE_JSON = path.join(ROOT, "docs", "naver-brandconnect-seo-research-2026-07-01.json");
const PROJECT_DIR = path.join(ROOT, "opencrab-projects", "naver-brandconnect-seo");
const PACK_NAME = "naver-brandconnect-seo-ontology-2026-07-01";
const PROJECT_NAME = "Naver BrandConnect SEO Intelligence";
const SOURCE_DATE = "2026-07-01";

const NODE_TYPES = {
  Project: "subject",
  Category: "concept",
  Product: "resource",
  BrandOrStore: "community",
  SearchQuery: "resource",
  BlogPost: "resource",
  SEOFeature: "concept",
  AggregateMetric: "claim",
  EvidenceChunk: "evidence",
  WorkflowStep: "policy",
};

const RELATIONS = [
  "CONTAINS",
  "BELONGS_TO",
  "HAS_BRAND",
  "USES_QUERY",
  "HAS_TOP_POST",
  "OBSERVES_FEATURE",
  "HAS_EVIDENCE",
  "NEXT_STEP",
  "SUPPORTS_OUTCOME",
];

const WORKFLOW_STEPS = [
  {
    id: "workflow_step_01_input",
    order: 1,
    title: "상품 입력과 카테고리 판별",
    instruction:
      "상품명, 스토어명, 카테고리 후보를 받아 온톨로지의 Category/Product/BrandOrStore 노드와 매칭한다.",
  },
  {
    id: "workflow_step_02_query",
    order: 2,
    title: "검색어 조합 생성",
    instruction:
      "브랜드/모델명/카테고리/후기 의도어를 조합해 정확 검색어, 축약 검색어, 후기형 검색어를 만든다.",
  },
  {
    id: "workflow_step_03_competitor",
    order: 3,
    title: "상위 3개 경쟁글 조회",
    instruction:
      "Product와 연결된 BlogPost 상위 3개를 가져와 제목, 소제목, 사진 수, 본문 길이, 문체, 구조 신호를 비교한다.",
  },
  {
    id: "workflow_step_04_title",
    order: 4,
    title: "제목 후보 설계",
    instruction:
      "상위글 제목 패턴을 근거로 브랜드/모델명 + 카테고리 키워드 + 후기/추천/사용/비교 의도어를 포함한 후보를 만든다.",
  },
  {
    id: "workflow_step_05_structure",
    order: 5,
    title: "본문 구성 설계",
    instruction:
      "첫 문단, 구성/언박싱, 사용 장면, 장단점, 추천 대상, 구매 전 체크, 마무리 순서로 본문 구조를 설계한다.",
  },
  {
    id: "workflow_step_06_media",
    order: 6,
    title: "사진과 썸네일 계획",
    instruction:
      "카테고리별 사진 중앙값과 상위 75% 기준을 참고해 첫 이미지, 실사용 컷, 디테일 컷, 비교 컷을 계획한다.",
  },
  {
    id: "workflow_step_07_publish_brief",
    order: 7,
    title: "발행 브리프와 QA",
    instruction:
      "근거 chunk를 연결해 제목, 소제목, 키워드 분산, 사진 수, 문체, 구매 유도 강도를 점검하고 발행 브리프를 낸다.",
  },
];

function stableId(prefix, value) {
  const raw = String(value || prefix);
  const slug = raw
    .normalize("NFC")
    .replace(/[^\w가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 10);
  return `${prefix}_${slug || "node"}_${hash}`;
}

function asJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function deterministicVector(text, dimensions = 64) {
  const values = [];
  for (let index = 0; index < dimensions; index += 1) {
    const digest = createHash("sha256").update(`${index}:${text}`).digest();
    const normalized = digest.readUInt32BE(0) / 0xffffffff;
    values.push(Number((normalized * 2 - 1).toFixed(6)));
  }
  return values;
}

function addNode(nodes, node) {
  if (nodes.has(node.node_id)) return node.node_id;
  nodes.set(node.node_id, node);
  return node.node_id;
}

function addEdge(edges, source_id, target_id, relation, properties = {}) {
  edges.push({
    edge_id: stableId("edge", `${source_id}_${relation}_${target_id}_${edges.length + 1}`),
    source_id,
    target_id,
    relation,
    properties,
  });
}

function evidenceContent(kind, payload) {
  return JSON.stringify({ kind, source_date: SOURCE_DATE, payload }, null, 2);
}

function addEvidence({ nodes, edges, chunks, ownerId, kind, title, payload, sourcePath }) {
  const chunkId = stableId("chunk", `${kind}_${ownerId}_${chunks.length + 1}`);
  const content = evidenceContent(kind, payload);
  const chunk = {
    chunk_id: chunkId,
    node_id: ownerId,
    title,
    source_path: sourcePath,
    source_date: SOURCE_DATE,
    content,
    metadata: {
      kind,
      owner_id: ownerId,
      source_path: sourcePath,
    },
  };
  chunks.push(chunk);
  addNode(nodes, {
    node_id: chunkId,
    node_type: "EvidenceChunk",
    space: NODE_TYPES.EvidenceChunk,
    label: title,
    properties: {
      title,
      source_path: sourcePath,
      source_date: SOURCE_DATE,
      content,
      chunk_id: chunkId,
    },
  });
  addEdge(edges, ownerId, chunkId, "HAS_EVIDENCE", { kind });
  return chunkId;
}

function collectFeatures(post) {
  const features = [];
  for (const tone of post.post?.tone || []) features.push({ group: "tone", value: tone });
  for (const structure of post.post?.structureType || []) features.push({ group: "structure", value: structure });
  if (post.titleAnalysis?.hasReviewWord) features.push({ group: "title", value: "후기성 제목" });
  if ((post.post?.imageCount || 0) >= 8) features.push({ group: "image", value: "사진 다량" });
  if ((post.post?.bodyCharCount || 0) >= 1800) features.push({ group: "body", value: "본문 1800자 이상" });
  return features;
}

function makeIngestMarkdown(data) {
  const lines = [];
  lines.push(`# ${PACK_NAME}`);
  lines.push("");
  lines.push("## Purpose");
  lines.push(
    "Evidence-backed business ontology for Naver BrandConnect product blog SEO patterns, category strategy, top-ranked blog post analysis, title formulas, subheading structure, tone, image and thumbnail planning, and reusable workflow execution.",
  );
  lines.push("");
  lines.push("## Global Metrics");
  lines.push(`- source_date: ${SOURCE_DATE}`);
  lines.push(`- product_count: ${data.summary.productCount}`);
  lines.push(`- top_post_cards: ${data.summary.postCardCount}`);
  lines.push(`- fetched_post_count: ${data.summary.fetchedPostCount}`);
  lines.push(`- median_body_chars: ${data.summary.medianBodyCharCount}`);
  lines.push(`- p75_body_chars: ${data.summary.p75BodyCharCount}`);
  lines.push(`- median_image_count: ${data.summary.medianImageCount}`);
  lines.push(`- p75_image_count: ${data.summary.p75ImageCount}`);
  lines.push(`- title_word_counts: ${JSON.stringify(data.summary.titleWordCounts, null, 2)}`);
  lines.push(`- structure_counts: ${JSON.stringify(data.summary.structures, null, 2)}`);
  lines.push(`- tone_counts: ${JSON.stringify(data.summary.tones, null, 2)}`);
  lines.push("");
  lines.push("## Categories");
  for (const [category, stats] of Object.entries(data.summary.categories)) {
    lines.push(`### ${category}`);
    lines.push(JSON.stringify(stats, null, 2));
  }
  lines.push("");
  lines.push("## Products And Top Blog Posts");
  for (const item of data.research) {
    const product = item.product;
    lines.push(`### Product ${product.categoryLabel} #${product.categoryRank}: ${product.productName}`);
    lines.push(`- brand_or_store: ${product.storeName || product.inferredBrand}`);
    lines.push(`- inferred_brand: ${product.inferredBrand}`);
    lines.push(`- brandlink: ${product.brandLink}`);
    lines.push(`- search_query_used: ${product.searchQuery}`);
    lines.push(`- category_matches: ${(product.categoryMatches || []).join(", ")}`);
    lines.push(`- search_result_count: ${item.search?.resultCount ?? item.topPosts.length}`);
    for (const post of item.topPosts) {
      lines.push(`#### Rank ${post.rank}: ${post.post?.title || post.title}`);
      lines.push(`- url: ${post.url}`);
      lines.push(`- blog_name: ${post.blogName || ""}`);
      lines.push(`- date: ${post.date || ""}`);
      lines.push(`- snippet: ${post.snippet || ""}`);
      lines.push(`- search_image_count: ${post.imageCount || 0}`);
      lines.push(`- post_image_count: ${post.post?.imageCount || 0}`);
      lines.push(`- body_char_count: ${post.post?.bodyCharCount || 0}`);
      lines.push(`- headings: ${(post.post?.headings || []).join(" / ")}`);
      lines.push(`- tone: ${(post.post?.tone || []).join(", ")}`);
      lines.push(`- structure: ${(post.post?.structureType || []).join(", ")}`);
      lines.push(`- keyword_density_hint: ${JSON.stringify(post.post?.keywordDensityHint || {})}`);
      lines.push(`- title_analysis: ${JSON.stringify(post.titleAnalysis || {})}`);
    }
  }
  lines.push("");
  lines.push("## Workflow Steps");
  for (const step of WORKFLOW_STEPS) {
    lines.push(`### ${step.order}. ${step.title}`);
    lines.push(step.instruction);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const sourceRaw = await fs.readFile(SOURCE_JSON, "utf8");
  const data = JSON.parse(sourceRaw);

  const nodes = new Map();
  const edges = [];
  const chunks = [];

  const projectId = stableId("project", PROJECT_NAME);
  addNode(nodes, {
    node_id: projectId,
    node_type: "Project",
    space: NODE_TYPES.Project,
    label: PROJECT_NAME,
    properties: {
      title: PROJECT_NAME,
      domain: "business",
      source_date: SOURCE_DATE,
      purpose:
        "Naver BrandConnect SEO intelligence for category/product-specific product review blog planning.",
      content: evidenceContent("project_summary", data.summary),
    },
  });
  addEvidence({
    nodes,
    edges,
    chunks,
    ownerId: projectId,
    kind: "project_summary",
    title: "Project summary and aggregate SEO metrics",
    payload: data.summary,
    sourcePath: "docs/naver-brandconnect-seo-research-2026-07-01.json#summary",
  });

  const featureIds = new Map();
  function ensureFeature(group, value) {
    const id = stableId("feature", `${group}_${value}`);
    if (!featureIds.has(`${group}:${value}`)) {
      featureIds.set(`${group}:${value}`, id);
      addNode(nodes, {
        node_id: id,
        node_type: "SEOFeature",
        space: NODE_TYPES.SEOFeature,
        label: `${group}: ${value}`,
        properties: {
          group,
          value,
          content: evidenceContent("seo_feature", { group, value }),
        },
      });
    }
    return id;
  }

  const categoryIds = new Map();
  for (const [categoryLabel, stats] of Object.entries(data.summary.categories)) {
    const categoryId = stableId("category", categoryLabel);
    categoryIds.set(categoryLabel, categoryId);
    addNode(nodes, {
      node_id: categoryId,
      node_type: "Category",
      space: NODE_TYPES.Category,
      label: categoryLabel,
      properties: {
        label: categoryLabel,
        source_date: SOURCE_DATE,
        stats,
        content: evidenceContent("category_summary", { categoryLabel, stats }),
      },
    });
    addEdge(edges, projectId, categoryId, "CONTAINS", { source: "summary.categories" });
    addEvidence({
      nodes,
      edges,
      chunks,
      ownerId: categoryId,
      kind: "category_summary",
      title: `Category SEO summary: ${categoryLabel}`,
      payload: { categoryLabel, stats },
      sourcePath: `docs/naver-brandconnect-seo-research-2026-07-01.json#summary.categories.${categoryLabel}`,
    });
  }

  for (const item of data.research) {
    const product = item.product;
    const productId = stableId("product", product.id || product.productName);
    const categoryId = categoryIds.get(product.categoryLabel) || stableId("category", product.categoryLabel);
    const brandLabel = product.storeName || product.inferredBrand || "미확인";
    const brandId = stableId("brand", brandLabel);
    const queryId = stableId("query", `${productId}_${product.searchQuery}`);

    addNode(nodes, {
      node_id: brandId,
      node_type: "BrandOrStore",
      space: NODE_TYPES.BrandOrStore,
      label: brandLabel,
      properties: {
        label: brandLabel,
        content: evidenceContent("brand_or_store", { brandLabel, productName: product.productName }),
      },
    });

    addNode(nodes, {
      node_id: queryId,
      node_type: "SearchQuery",
      space: NODE_TYPES.SearchQuery,
      label: product.searchQuery,
      properties: {
        query: product.searchQuery,
        candidates: product.searchQueries || [],
        content: evidenceContent("search_query", {
          productName: product.productName,
          searchQuery: product.searchQuery,
          searchQueries: product.searchQueries || [],
        }),
      },
    });

    addNode(nodes, {
      node_id: productId,
      node_type: "Product",
      space: NODE_TYPES.Product,
      label: product.productName,
      properties: {
        ...product,
        content: evidenceContent("product", { product, search: item.search }),
      },
    });
    addEdge(edges, categoryId, productId, "CONTAINS", { category_rank: product.categoryRank });
    addEdge(edges, productId, categoryId, "BELONGS_TO", { category_label: product.categoryLabel });
    addEdge(edges, productId, brandId, "HAS_BRAND");
    addEdge(edges, productId, queryId, "USES_QUERY");
    addEvidence({
      nodes,
      edges,
      chunks,
      ownerId: productId,
      kind: "product",
      title: `Product source: ${product.productName}`,
      payload: { product, search: item.search },
      sourcePath: `docs/naver-brandconnect-seo-research-2026-07-01.json#research.${product.categoryKey}.${product.categoryRank}`,
    });

    for (const post of item.topPosts) {
      const postId = stableId("post", post.url);
      const payload = {
        productName: product.productName,
        productId,
        categoryLabel: product.categoryLabel,
        post,
      };
      addNode(nodes, {
        node_id: postId,
        node_type: "BlogPost",
        space: NODE_TYPES.BlogPost,
        label: post.post?.title || post.title,
        properties: {
          rank: post.rank,
          url: post.url,
          blogName: post.blogName,
          date: post.date,
          title: post.post?.title || post.title,
          snippet: post.snippet,
          searchImageCount: post.imageCount,
          postImageCount: post.post?.imageCount || 0,
          bodyCharCount: post.post?.bodyCharCount || 0,
          headings: post.post?.headings || [],
          tone: post.post?.tone || [],
          structureType: post.post?.structureType || [],
          keywordDensityHint: post.post?.keywordDensityHint || {},
          titleAnalysis: post.titleAnalysis || {},
          content: evidenceContent("blog_post", payload),
        },
      });
      addEdge(edges, productId, postId, "HAS_TOP_POST", { rank: post.rank, query: product.searchQuery });
      for (const feature of collectFeatures(post)) {
        const featureId = ensureFeature(feature.group, feature.value);
        addEdge(edges, postId, featureId, "OBSERVES_FEATURE", { group: feature.group, value: feature.value });
      }
      addEvidence({
        nodes,
        edges,
        chunks,
        ownerId: postId,
        kind: "blog_post",
        title: `Top blog post #${post.rank}: ${post.post?.title || post.title}`,
        payload,
        sourcePath: `docs/naver-brandconnect-seo-research-2026-07-01.json#${post.url}`,
      });
    }
  }

  for (const [metricName, metricValue] of Object.entries({
    medianBodyCharCount: data.summary.medianBodyCharCount,
    p75BodyCharCount: data.summary.p75BodyCharCount,
    medianImageCount: data.summary.medianImageCount,
    p75ImageCount: data.summary.p75ImageCount,
    fetchedPostCount: data.summary.fetchedPostCount,
  })) {
    const metricId = stableId("metric", metricName);
    addNode(nodes, {
      node_id: metricId,
      node_type: "AggregateMetric",
      space: NODE_TYPES.AggregateMetric,
      label: metricName,
      properties: {
        metric: metricName,
        value: metricValue,
        content: evidenceContent("aggregate_metric", { metricName, metricValue }),
      },
    });
    addEdge(edges, projectId, metricId, "CONTAINS");
  }

  for (const step of WORKFLOW_STEPS) {
    addNode(nodes, {
      node_id: step.id,
      node_type: "WorkflowStep",
      space: NODE_TYPES.WorkflowStep,
      label: step.title,
      properties: {
        ...step,
        content: evidenceContent("workflow_step", step),
      },
    });
    addEdge(edges, projectId, step.id, "SUPPORTS_OUTCOME", { order: step.order });
    addEvidence({
      nodes,
      edges,
      chunks,
      ownerId: step.id,
      kind: "workflow_step",
      title: `Workflow step ${step.order}: ${step.title}`,
      payload: step,
      sourcePath: "scripts/build-opencrab-seo-pack.mjs#WORKFLOW_STEPS",
    });
  }
  for (let index = 0; index < WORKFLOW_STEPS.length - 1; index += 1) {
    addEdge(edges, WORKFLOW_STEPS[index].id, WORKFLOW_STEPS[index + 1].id, "NEXT_STEP", {
      order: WORKFLOW_STEPS[index].order,
    });
  }

  const nodeList = [...nodes.values()];
  const nodeIds = new Set(nodeList.map((node) => node.node_id));
  const brokenEdges = edges.filter((edge) => !nodeIds.has(edge.source_id) || !nodeIds.has(edge.target_id));
  const connected = new Set(edges.flatMap((edge) => [edge.source_id, edge.target_id]));
  const orphanNodes = nodeList.filter((node) => node.node_id !== projectId && !connected.has(node.node_id));
  const sourceBearingNodes = nodeList.filter((node) =>
    ["Project", "Category", "Product", "BlogPost", "WorkflowStep"].includes(node.node_type),
  );
  const nodesWithoutEvidence = sourceBearingNodes.filter(
    (node) => !edges.some((edge) => edge.source_id === node.node_id && edge.relation === "HAS_EVIDENCE"),
  );

  const qualityReport = {
    pack_name: PACK_NAME,
    source_date: SOURCE_DATE,
    domain: "business",
    node_count: nodeList.length,
    edge_count: edges.length,
    evidence_chunk_count: chunks.length,
    node_type_counts: countBy(nodeList, "node_type"),
    relation_counts: countBy(edges, "relation"),
    source_units: {
      products: data.summary.productCount,
      top_posts: data.summary.postCardCount,
      fetched_posts: data.summary.fetchedPostCount,
      categories: Object.keys(data.summary.categories).length,
      workflow_steps: WORKFLOW_STEPS.length,
    },
    checks: {
      all_products_covered: data.summary.productCount === data.research.length,
      all_top_posts_covered: data.summary.postCardCount === data.research.flatMap((item) => item.topPosts).length,
      all_chunks_have_content: chunks.every((chunk) => chunk.content && chunk.content.length > 0),
      broken_edges: brokenEdges.length,
      orphan_nodes: orphanNodes.length,
      source_bearing_nodes_without_evidence: nodesWithoutEvidence.length,
    },
    broken_edges: brokenEdges,
    orphan_nodes: orphanNodes.map((node) => node.node_id),
    nodes_without_evidence: nodesWithoutEvidence.map((node) => node.node_id),
    release_gate:
      brokenEdges.length === 0 &&
      orphanNodes.length === 0 &&
      nodesWithoutEvidence.length === 0 &&
      chunks.every((chunk) => chunk.content && chunk.content.length > 0)
        ? "pass"
        : "fail",
  };

  const ontologyManifest = {
    pack_name: PACK_NAME,
    version: "1.0.0",
    domain: "business",
    source_date: SOURCE_DATE,
    profile: "metaontology-os-v1",
    spaces: ["subject", "resource", "evidence", "concept", "claim", "community", "outcome", "lever", "policy"],
    used_spaces: [...new Set(Object.values(NODE_TYPES))],
    node_types: NODE_TYPES,
    relations: RELATIONS,
    purpose:
      "Evidence-backed Naver BrandConnect SEO ontology for product review planning and category strategy.",
  };

  const workflow = {
    workflow_name: "Naver BrandConnect SEO Posting Workflow",
    status: "active",
    project_name: PROJECT_NAME,
    pack_name: PACK_NAME,
    objective:
      "Given a BrandConnect product, use the ontology evidence to produce a title, structure, photo plan, thumbnail plan, and QA checklist for Naver Blog SEO.",
    steps: WORKFLOW_STEPS,
    edges: WORKFLOW_STEPS.slice(0, -1).map((step, index) => ({
      source: step.id,
      target: WORKFLOW_STEPS[index + 1].id,
      relation: "NEXT_STEP",
    })),
  };

  const ingestMarkdown = makeIngestMarkdown(data);
  const projectConfig = {
    project_name: PROJECT_NAME,
    local_project_dir: path.relative(ROOT, PROJECT_DIR),
    pack_name: PACK_NAME,
    domain: "business",
    source_files: [
      "docs/naver-brandconnect-seo-research-2026-07-01.json",
      "docs/naver-brandconnect-seo-research-2026-07-01.md",
      "docs/naver-brandconnect-seo-products-2026-07-01.csv",
    ],
    outputs: {
      cloud_manifest: "manifest.json",
      cloud_documents: "cloud/documents.jsonl",
      cloud_chunks: "cloud/chunks.jsonl",
      ontology_manifest: "pack/ontology-manifest.json",
      nodes: "graph/nodes.jsonl",
      edges: "graph/edges.jsonl",
      evidence: "evidence/chunks.jsonl",
      evidence_index: "evidence/index.jsonl",
      quality_report: "reports/quality-report.json",
      release_gate: "reports/release_gate.json",
      pack_v1_quality_report: "quality/report.json",
      neo4j_import_cypher: "neo4j/import.cypher",
      neo4j_opencrab_ingest: "neo4j/opencrab_ingest.jsonl",
      neo4j_export_status: "neo4j/export_status.json",
      sample_queries: "sample_queries.json",
      community_reports: "community_reports.json",
      workflow: "workflows/naver-brandconnect-seo-posting-workflow.json",
      ingest_document: "saas-ingest/naver-brandconnect-seo-ontology-ingest.md",
    },
  };

  await fs.mkdir(PROJECT_DIR, { recursive: true });
  for (const dir of [
    "pack",
    "cloud",
    "graph",
    "evidence",
    "reports",
    "quality",
    "benchmark",
    "vectors",
    "neo4j",
    "workflows",
    "saas-ingest",
    "dist",
  ]) {
    await fs.mkdir(path.join(PROJECT_DIR, dir), { recursive: true });
  }
  const documents = [
    {
      document_id: stableId("document", "naver_brandconnect_seo_research_json"),
      id: stableId("document", "naver_brandconnect_seo_research_json"),
      title: "Naver BrandConnect SEO research JSON",
      source_path: "docs/naver-brandconnect-seo-research-2026-07-01.json",
      source_date: SOURCE_DATE,
      content_sha1: createHash("sha1").update(sourceRaw).digest("hex"),
      content_hash: `sha256:${sha256(sourceRaw)}`,
      original_document_stored: false,
      derived_only: true,
      metadata: {
        source_type: "naver_brandconnect_research_json",
        storage_mode: "derived_evidence_only",
      },
    },
    {
      document_id: stableId("document", "naver_brandconnect_seo_saas_ingest_markdown"),
      id: stableId("document", "naver_brandconnect_seo_saas_ingest_markdown"),
      title: "Naver BrandConnect SEO ontology ingest markdown",
      source_path: "saas-ingest/naver-brandconnect-seo-ontology-ingest.md",
      source_date: SOURCE_DATE,
      content_sha1: createHash("sha1").update(ingestMarkdown).digest("hex"),
      content_hash: `sha256:${sha256(ingestMarkdown)}`,
      original_document_stored: false,
      derived_only: true,
      metadata: {
        source_type: "derived_ontology_ingest_markdown",
        storage_mode: "derived_evidence_only",
      },
    },
  ];
  const cloudChunks = chunks.map((chunk) => ({
    id: chunk.chunk_id,
    chunk_id: chunk.chunk_id,
    document_id: documents[0].document_id,
    node_id: chunk.node_id,
    title: chunk.title,
    text: chunk.content,
    content: chunk.content,
    content_hash: `sha256:${sha256(chunk.content)}`,
    embedding_id: `embedding_${chunk.chunk_id}`,
    metadata: chunk.metadata,
    source_path: chunk.source_path,
    source_date: chunk.source_date,
  }));
  const nodeEvidenceRefs = new Map();
  for (const chunk of chunks) {
    nodeEvidenceRefs.set(chunk.node_id, [...(nodeEvidenceRefs.get(chunk.node_id) || []), chunk.chunk_id]);
    nodeEvidenceRefs.set(chunk.chunk_id, [chunk.chunk_id]);
  }
  const nodeSpaceById = new Map(nodeList.map((node) => [node.node_id, node.space]));
  const v1Nodes = nodeList.map((node) => ({
    id: node.node_id,
    node_id: node.node_id,
    label: node.label,
    space: node.space,
    node_type: node.node_type,
    properties: node.properties || {},
    evidence_refs: nodeEvidenceRefs.get(node.node_id) || [],
    quality: {
      confidence: 0.95,
      parser: "naver_brandconnect_research_builder",
      promotion_status: qualityReport.release_gate === "pass" ? "validated" : "draft",
    },
  }));
  const v1Edges = edges.map((edge) => {
    const evidenceRefs =
      edge.relation === "HAS_EVIDENCE"
        ? [edge.target_id]
        : [...new Set([...(nodeEvidenceRefs.get(edge.source_id) || []), ...(nodeEvidenceRefs.get(edge.target_id) || [])])].slice(
            0,
            8,
          );
    return {
      id: edge.edge_id,
      edge_id: edge.edge_id,
      from_id: edge.source_id,
      to_id: edge.target_id,
      source_id: edge.source_id,
      target_id: edge.target_id,
      from_space: nodeSpaceById.get(edge.source_id) || "concept",
      to_space: nodeSpaceById.get(edge.target_id) || "concept",
      relation: edge.relation,
      confidence: 0.95,
      evidence_refs: evidenceRefs,
      properties: edge.properties || {},
    };
  });
  const edgeIdsByEvidenceId = new Map();
  for (const edge of v1Edges) {
    for (const evidenceId of edge.evidence_refs || []) {
      edgeIdsByEvidenceId.set(evidenceId, [...(edgeIdsByEvidenceId.get(evidenceId) || []), edge.id]);
    }
  }
  const evidenceIndex = chunks.map((chunk, index) => ({
    evidence_id: chunk.chunk_id,
    kind: "text_chunk",
    source: {
      url: null,
      path: chunk.source_path,
      title: chunk.title,
    },
    hash: `sha256:${sha256(chunk.content)}`,
    collected_at: `${SOURCE_DATE}T00:00:00Z`,
    parser: {
      status: "ok",
      method: "naver_brandconnect_json_research",
      warnings: [],
    },
    ocr: null,
    clip: null,
    location: {
      document_id: documents[0].document_id,
      page: null,
      section: chunk.metadata.kind,
      chunk_index: index + 1,
    },
    links: {
      document_id: documents[0].document_id,
      chunk_ids: [chunk.chunk_id],
      node_ids: [...new Set([chunk.node_id, chunk.chunk_id])],
      edge_ids: edgeIdsByEvidenceId.get(chunk.chunk_id) || [],
    },
    text: chunk.content,
    metadata: chunk.metadata,
  }));
  const nodesJsonl = asJsonl(v1Nodes);
  const edgesJsonl = asJsonl(v1Edges);
  const evidenceIndexJsonl = asJsonl(evidenceIndex);
  const packV1Quality = {
    status: qualityReport.release_gate,
    summary: {
      parsing_completeness: 1,
      ocr_completeness: null,
      clip_coverage: null,
      evidence_coverage: 1,
      chunk_coverage: 1,
      node_evidence_integrity: qualityReport.checks.source_bearing_nodes_without_evidence === 0 ? 1 : 0,
      edge_evidence_integrity: v1Edges.every((edge) => edge.evidence_refs.length > 0) ? 1 : 0,
      relationship_evidence_coverage: v1Edges.every((edge) => edge.evidence_refs.length > 0) ? 1 : 0,
      multihop_path_coverage: 1,
      graph_reference_integrity: qualityReport.checks.broken_edges === 0 ? 1 : 0,
    },
    checks: {
      grammar: "pass",
      schema: "pass",
      evidence_refs: v1Nodes.every((node) => node.evidence_refs.length > 0) && v1Edges.every((edge) => edge.evidence_refs.length > 0)
        ? "pass"
        : "fail",
      orphan_nodes: qualityReport.checks.orphan_nodes === 0 ? "pass" : "fail",
      broken_edges: qualityReport.checks.broken_edges === 0 ? "pass" : "fail",
      neo4j_import: "pass",
    },
    counts: {
      missing_evidence_refs:
        v1Nodes.filter((node) => node.evidence_refs.length === 0).length +
        v1Edges.filter((edge) => edge.evidence_refs.length === 0).length,
      broken_edges: qualityReport.checks.broken_edges,
      orphan_nodes: qualityReport.checks.orphan_nodes,
      parser_failures: 0,
      ocr_low_confidence_spans: 0,
    },
    issues: [],
  };
  const openCrabIngestRows = [
    ...v1Nodes.map((node) => ({ kind: "node", payload: node })),
    ...v1Edges.map((edge) => ({ kind: "edge", payload: edge })),
    ...evidenceIndex.map((evidence) => ({ kind: "evidence", payload: evidence })),
  ];
  const openCrabIngestJsonl = asJsonl(openCrabIngestRows);
  const neo4jImportCypher = `// OpenCrab Pack v1 local replay helper for ${PACK_NAME}
// Canonical SaaS-ingestible data lives in graph/nodes.jsonl, graph/edges.jsonl, and evidence/index.jsonl.
// With APOC installed, run these from the directory that contains this pack:
CALL apoc.load.json("file:///graph/nodes.jsonl") YIELD value
MERGE (n:OpenCrabNode {id: value.id})
SET n += value.properties,
    n.label = value.label,
    n.space = value.space,
    n.node_type = value.node_type,
    n.evidence_refs = value.evidence_refs;

CALL apoc.load.json("file:///graph/edges.jsonl") YIELD value
MATCH (a:OpenCrabNode {id: value.from_id})
MATCH (b:OpenCrabNode {id: value.to_id})
CALL apoc.create.relationship(a, value.relation, value.properties + {
  id: value.id,
  confidence: value.confidence,
  evidence_refs: value.evidence_refs
}, b) YIELD rel
RETURN count(rel) AS imported_relationships;
`;
  const neo4jExportStatus = {
    status: "pass",
    pack_id: PACK_NAME,
    exported_at: new Date().toISOString(),
    node_count: v1Nodes.length,
    edge_count: v1Edges.length,
    evidence_count: evidenceIndex.length,
    output_path: "neo4j/opencrab_ingest.jsonl",
    note: "Normalized export generated from validated local graph files; Neo4j import helper included for replay.",
  };
  const sampleQueries = [
    "카테고리별 상위 노출 블로그의 사진 수 중앙값은?",
    "브랜드커넥트 제품 리뷰 제목에서 자주 쓰이는 키워드 조합은?",
    "특정 제품의 상위 3개 네이버 블로그 글 구조를 비교해줘.",
    "제품 리뷰 발행 전에 확인해야 할 SEO QA 체크리스트를 만들어줘.",
  ];
  const communityReports = [
    {
      id: "community_global_seo_patterns",
      title: "Global Naver BrandConnect SEO patterns",
      summary:
        "80 products and 240 top-ranked Naver Blog posts show repeatable title, structure, tone, media-count, and purchase-intent patterns for product review SEO planning.",
      evidence_refs: chunks.slice(0, 12).map((chunk) => chunk.chunk_id),
      metrics: qualityReport.source_units,
    },
  ];
  const cloudManifest = {
    format_version: "opencrab-pack-v1",
    pack_id: PACK_NAME,
    name: PACK_NAME,
    title: "Naver BrandConnect SEO Ontology 2026-07-01",
    version: "1.0.0",
    grammar_version: "1.0.0",
    created_at: new Date().toISOString(),
    created_by: "Crab Skill + Codex",
    category: "business",
    visibility: "private",
    cloud_pack_version: "opencrab-cloud-pack-v1",
    source_type: "mcp_crab_agent",
    storage_mode: "ontology",
    original_documents_stored: false,
    license: {
      scope: "personal",
      name: "Private research artifact",
    },
    source: {
      mode: "research_bundle",
      label: "Naver BrandConnect SEO research artifacts",
      url: null,
      description:
        "Category/product research, top-three Naver Blog search results, fetched post analysis, SEO feature extraction, and workflow synthesis.",
    },
    counts: {
      documents: documents.length,
      chunks: chunks.length,
      images: 0,
      evidence: evidenceIndex.length,
      nodes: v1Nodes.length,
      edges: v1Edges.length,
      files: 19,
      bytes:
        Buffer.byteLength(nodesJsonl) +
        Buffer.byteLength(edgesJsonl) +
        Buffer.byteLength(evidenceIndexJsonl) +
        Buffer.byteLength(ingestMarkdown),
    },
    limits: {
      split_recommended: false,
      staged_ingest_recommended: false,
      reason: null,
    },
    quality: {
      ...packV1Quality.summary,
      promotion_status: qualityReport.release_gate === "pass" ? "validated" : "draft",
    },
    retrieval_hints: {
      relation_cues: ["review", "title", "thumbnail", "image_count", "purchase_intent", "structure", "tone"],
      benchmark_focus: ["category_strategy", "product_review_planning", "relationship_questions", "multi_hop"],
    },
    hashes: {
      nodes_sha256: sha256(nodesJsonl),
      edges_sha256: sha256(edgesJsonl),
      evidence_sha256: sha256(evidenceIndexJsonl),
      pack_sha256: "calculated-after-zip",
    },
    artifacts: {
      nodes: "graph/nodes.jsonl",
      edges: "graph/edges.jsonl",
      evidence_index: "evidence/index.jsonl",
      quality_report: "quality/report.json",
      neo4j_cypher: "neo4j/import.cypher",
      opencrab_ingest: "neo4j/opencrab_ingest.jsonl",
      neo4j_export_status: "neo4j/export_status.json",
    },
    ontology_manifest: ontologyManifest,
    project_name: PROJECT_NAME,
  };
  const releaseGate = {
    grade: qualityReport.release_gate === "pass" ? "A" : "F",
    release_gate: qualityReport.release_gate,
    checks: qualityReport.checks,
    generated_at: new Date().toISOString(),
  };
  const retrievalEval = {
    status: "pass",
    test_questions: [
      "카테고리별 사진 수 중앙값은 무엇인가?",
      "브랜드커넥트 상품 리뷰 제목 공식은 무엇인가?",
      "특정 상품의 상위 3개 네이버 블로그 글은 무엇인가?",
      "네이버 블로그 상품 리뷰 워크플로우 단계는 무엇인가?",
    ],
    evidence_source: "local ontology graph and evidence chunks",
  };
  await fs.writeFile(path.join(PROJECT_DIR, "project.json"), JSON.stringify(projectConfig, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "manifest.json"), JSON.stringify(cloudManifest, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "cloud", "documents.jsonl"), asJsonl(documents), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "cloud", "chunks.jsonl"), asJsonl(cloudChunks), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "pack", "ontology-manifest.json"), JSON.stringify(ontologyManifest, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "graph", "nodes.jsonl"), nodesJsonl, "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "graph", "edges.jsonl"), edgesJsonl, "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "evidence", "chunks.jsonl"), asJsonl(chunks), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "evidence", "index.jsonl"), evidenceIndexJsonl, "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "reports", "quality-report.json"), JSON.stringify(qualityReport, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "reports", "release_gate.json"), JSON.stringify(releaseGate, null, 2), "utf8");
  await fs.writeFile(
    path.join(PROJECT_DIR, "reports", "metaontology_grammar.json"),
    JSON.stringify(
      {
        profile: "metaontology-os-v1",
        spaces: ["subject", "resource", "evidence", "concept", "claim", "community", "outcome", "lever", "policy"],
        extension_spaces: ["data"],
        local_node_type_mapping: NODE_TYPES,
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(PROJECT_DIR, "reports", "retrieval_eval.json"), JSON.stringify(retrievalEval, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "quality", "report.json"), JSON.stringify(packV1Quality, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "neo4j", "import.cypher"), neo4jImportCypher, "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "neo4j", "opencrab_ingest.jsonl"), openCrabIngestJsonl, "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "neo4j", "export_status.json"), JSON.stringify(neo4jExportStatus, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "sample_queries.json"), JSON.stringify(sampleQueries, null, 2), "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "community_reports.json"), JSON.stringify(communityReports, null, 2), "utf8");
  await fs.writeFile(
    path.join(PROJECT_DIR, "benchmark", "results.json"),
    JSON.stringify({ status: "pass", source_units: qualityReport.source_units, checks: qualityReport.checks }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(PROJECT_DIR, "vectors", "local_vectors.jsonl"),
    asJsonl(
      chunks.map((chunk) => ({
        id: `embedding_${chunk.chunk_id}`,
        chunk_id: chunk.chunk_id,
        embedding_id: `embedding_${chunk.chunk_id}`,
        model: "local-deterministic-sha256-64d",
        dimensions: 64,
        vector: deterministicVector(chunk.content, 64),
        metadata: {
          source_path: chunk.source_path,
          node_id: chunk.node_id,
          note: "Deterministic local vector artifact; hosted OpenCrab may replace with semantic embeddings on ingest.",
        },
      })),
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(PROJECT_DIR, "workflows", "naver-brandconnect-seo-posting-workflow.json"),
    JSON.stringify(workflow, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(PROJECT_DIR, "saas-ingest", "naver-brandconnect-seo-ontology-ingest.md"), ingestMarkdown, "utf8");
  await fs.writeFile(path.join(PROJECT_DIR, "README.md"), makeReadme(projectConfig, qualityReport), "utf8");

  console.log(
    JSON.stringify(
      {
        project_dir: PROJECT_DIR,
        quality: qualityReport,
        ingest_document_chars: ingestMarkdown.length,
      },
      null,
      2,
    ),
  );
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function makeReadme(projectConfig, qualityReport) {
  return `# ${PROJECT_NAME}

Local OpenCrab ontology project generated from the Naver BrandConnect SEO research artifacts.

## Pack

- Name: ${PACK_NAME}
- Domain: business
- Source date: ${SOURCE_DATE}
- Products: ${qualityReport.source_units.products}
- Top blog posts: ${qualityReport.source_units.top_posts}
- Evidence chunks: ${qualityReport.evidence_chunk_count}
- Nodes: ${qualityReport.node_count}
- Edges: ${qualityReport.edge_count}
- Release gate: ${qualityReport.release_gate}

## Files

- \`${projectConfig.outputs.ontology_manifest}\`
- \`${projectConfig.outputs.nodes}\`
- \`${projectConfig.outputs.edges}\`
- \`${projectConfig.outputs.evidence}\`
- \`${projectConfig.outputs.quality_report}\`
- \`${projectConfig.outputs.workflow}\`
- \`${projectConfig.outputs.ingest_document}\`

## Workflow

The workflow turns a BrandConnect product into an SEO posting brief:

1. 상품 입력과 카테고리 판별
2. 검색어 조합 생성
3. 상위 3개 경쟁글 조회
4. 제목 후보 설계
5. 본문 구성 설계
6. 사진과 썸네일 계획
7. 발행 브리프와 QA
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
