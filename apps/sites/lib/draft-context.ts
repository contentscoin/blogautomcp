/**
 * post_submit_draft 가 준비 작업(POST_PREPARE_DRAFT) 결과에서 상품 스냅샷을 찾는 규칙.
 *
 * 데스크톱 1.3.9 는 결과 data 최상위에 brand-draft-context/v2(snapshot·snapshotId·…)를 두었고,
 * 1.3.10 은 같은 객체를 data.context 아래로 내려 제출이 전부 PRODUCT_SNAPSHOT_CHANGED 로 막혔다.
 * 사이트는 두 형태를 모두 받아들이고, PC 에는 검증에 필요한 슬림 컨텍스트만 전달한다
 * (PC 는 snapshot·snapshotId 만 읽으며 제출 컨텍스트 파일을 850KB 로 제한한다).
 * 의존성이 없어야 한다: 루트 회귀 테스트가 이 파일을 그대로 import 한다.
 */

type JsonObject = Record<string, unknown>;

export interface PreparedDraftContextExpectation {
  productId: string;
  /** 소문자 connectKind(shopping|travel). */
  connectKind: string;
}

export type PreparedDraftContextResolution =
  | {
      ok: true;
      productId: string;
      connectKind: string;
      snapshotId: string;
      /** 큐 작업 입력(args.contextSnapshot)으로 전달할 슬림 컨텍스트. */
      forward: JsonObject;
    }
  | { ok: false; code: 'PRODUCT_SNAPSHOT_CHANGED'; message: string };

const SNAPSHOT_ID_PATTERN = /^[a-f0-9]{64}$/;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringField(record: JsonObject, key: string): string {
  return typeof record[key] === 'string' ? (record[key] as string).trim() : '';
}

function firstString(records: JsonObject[], key: string): string {
  for (const record of records) {
    const value = stringField(record, key);
    if (value) return value;
  }
  return '';
}

function firstObject(records: JsonObject[], key: string): JsonObject | null {
  for (const record of records) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as JsonObject).length > 0) {
      return value as JsonObject;
    }
  }
  return null;
}

export function resolvePreparedDraftContext(
  contextResult: unknown,
  expected: PreparedDraftContextExpectation,
): PreparedDraftContextResolution {
  const result = asObject(contextResult);
  const data = asObject(result.data);
  // 1.3.10 데스크톱은 원본 컨텍스트를 data.context 아래에 두었다.
  const nested = asObject(data.context);
  const layers = [data, nested, result];

  const productId = firstString(layers, 'productId');
  const snapshot = firstObject([data, nested], 'snapshot');
  const snapshotId = firstString([data, nested], 'snapshotId');
  const snapshotProductId = snapshot ? stringField(snapshot, 'productId') : '';
  const snapshotConnectKind = snapshot ? stringField(snapshot, 'connectKind').toLowerCase() : '';
  const snapshotOwnId = snapshot ? stringField(snapshot, 'snapshotId') : '';

  if (
    !expected.productId || !productId || productId !== expected.productId ||
    !snapshot || snapshotProductId !== expected.productId || snapshotConnectKind !== expected.connectKind ||
    !SNAPSHOT_ID_PATTERN.test(snapshotOwnId) || snapshotId !== snapshotOwnId
  ) {
    return {
      ok: false,
      code: 'PRODUCT_SNAPSHOT_CHANGED',
      message: '초안 생성 시점의 상품 스냅샷이 없거나 상품 식별자가 변경되었습니다. post_prepare_draft부터 다시 실행하세요.',
    };
  }

  const forward: JsonObject = {
    version: firstString([data, nested], 'version') || 'brand-draft-context/v2',
    productId,
    connectKind: firstString([data, nested], 'connectKind') || expected.connectKind,
    externalProductId: firstString([data, nested], 'externalProductId') || null,
    sourceUrl: firstString([data, nested], 'sourceUrl') || null,
    generatedAt: firstString([data, nested], 'generatedAt') || null,
    snapshotId,
    snapshot,
  };
  const contextJobId = firstString(layers, 'contextJobId');
  if (contextJobId) forward.contextJobId = contextJobId;

  return { ok: true, productId, connectKind: expected.connectKind, snapshotId, forward };
}
