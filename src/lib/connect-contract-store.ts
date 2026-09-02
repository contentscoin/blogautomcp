/**
 * 캡처한 커넥트 목록 계약을 디스크에 보관한다.
 *
 * 설치 경로는 읽기 전용일 수 있으므로 항상 쓰기 가능한 userData 아래에 저장한다
 * (패키징 앱: %APPDATA%/brandconnect-automation/data, 개발: <repo>/data).
 */

import fs from "node:fs";
import path from "node:path";
import { getAppDataDir } from "../../scripts/lib/app-paths";
import type { ConnectFieldMap } from "./connect-item";
import {
  buildConnectContract,
  CONNECT_KINDS,
  type ConnectContract,
  type ConnectKind,
} from "./brandconnect-kind";

/**
 * 같은 커넥트 화면에서 발견된 하나의 목록 피드다.
 *
 * 여행커넥트는 가격하락·지역인기·특가처럼 여러 section/tab 조합을 각각
 * 별도 요청으로 제공한다. 단일 엔드포인트 계약만 저장하면 가장 큰 한 응답만
 * 남기 때문에, 하위 호환용 최상위 계약과 함께 모든 관측 피드를 보관한다.
 */
export interface StoredConnectFeed {
  listEndpoint: string;
  listQuery: Record<string, string>;
  itemsPath: string;
  fieldMap: ConnectFieldMap;
  sampleCount: number;
}

export interface StoredConnectContract {
  kind: ConnectKind;
  capturedAt: string;
  /** 목록 JSON을 돌려준 엔드포인트(origin + pathname). */
  listEndpoint: string;
  /** 캡처 당시 그 엔드포인트에 붙어 있던 쿼리스트링 파라미터. */
  listQuery: Record<string, string>;
  /** 응답 루트에서 항목 배열까지의 경로(`$.data` 등). */
  itemsPath: string;
  fieldMap: ConnectFieldMap;
  /** 계약을 발견한 화면 URL. 재조회 시 referer로 쓴다. */
  sourceUrl: string;
  /** 캡처 시점에 확인한 항목 수(진단용). */
  sampleCount: number;
  /** 여러 추천 section/tab을 합쳐야 하는 커넥트의 목록 피드. 구버전 계약에는 없다. */
  feeds?: StoredConnectFeed[];
}

const CONTRACT_DIR_NAME = "connect-contracts";

function contractFile(kind: ConnectKind): string {
  return path.join(getAppDataDir(), CONTRACT_DIR_NAME, `${kind}.json`);
}

function isConnectFieldMap(value: unknown): value is ConnectFieldMap {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Record<string, unknown>;
  if (typeof map.name !== "string" || !map.name) return false;
  return (["id", "storeName", "price", "imageUrl", "linkUrl"] as const).every(
    (key) => map[key] === null || typeof map[key] === "string"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string")
  );
}

function isStoredConnectFeed(value: unknown): value is StoredConnectFeed {
  if (typeof value !== "object" || value === null) return false;
  const feed = value as Record<string, unknown>;
  return (
    typeof feed.listEndpoint === "string" &&
    feed.listEndpoint.length > 0 &&
    isStringRecord(feed.listQuery) &&
    typeof feed.itemsPath === "string" &&
    feed.itemsPath.length > 0 &&
    isConnectFieldMap(feed.fieldMap) &&
    typeof feed.sampleCount === "number" &&
    Number.isFinite(feed.sampleCount) &&
    feed.sampleCount >= 0
  );
}

function isStoredConnectContract(value: unknown): value is StoredConnectContract {
  if (typeof value !== "object" || value === null) return false;
  const contract = value as Record<string, unknown>;
  return (
    typeof contract.kind === "string" &&
    CONNECT_KINDS.includes(contract.kind as ConnectKind) &&
    typeof contract.listEndpoint === "string" &&
    contract.listEndpoint.length > 0 &&
    isStringRecord(contract.listQuery) &&
    typeof contract.itemsPath === "string" &&
    contract.itemsPath.length > 0 &&
    isConnectFieldMap(contract.fieldMap) &&
    (contract.feeds === undefined ||
      (Array.isArray(contract.feeds) &&
        contract.feeds.length > 0 &&
        contract.feeds.every(isStoredConnectFeed)))
  );
}

export function readStoredConnectContract(kind: ConnectKind): StoredConnectContract | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(contractFile(kind), "utf8"));
    if (!isStoredConnectContract(parsed)) return null;
    // 파일명과 내용이 어긋난 계약은 잘못 저장된 것으로 보고 버린다.
    return parsed.kind === kind ? parsed : null;
  } catch {
    return null;
  }
}

export function hasStoredConnectContract(kind: ConnectKind): boolean {
  return readStoredConnectContract(kind) !== null;
}

export function writeStoredConnectContract(contract: StoredConnectContract): string {
  const target = contractFile(contract.kind);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(contract, null, 2), "utf8");
  return target;
}

export function clearStoredConnectContract(kind: ConnectKind): void {
  fs.rmSync(contractFile(kind), { force: true });
}

/**
 * 커넥트 종류별 사용 가능 여부를 판단한다.
 *
 * 쇼핑커넥트는 엔드포인트가 코드에 내장돼 있어 항상 가능하고, 여행커넥트는
 * 계약을 캡처해 저장해 둔 경우에만 가능하다 — 캡처를 마쳤는데도 계속
 * "캡처 필요"로 막히던 것이 이 함수가 고치는 문제다.
 *
 * 여행커넥트 등록·발행도 캡처 후에는 허용한다. 에디터 삽입은 발행 단계에서
 * 삽입 결과를 검증해 실패 시 발행을 중단하므로(fail-closed), 잘못된 링크가
 * 글에 들어가는 일은 여기서가 아니라 그 검증이 막는다.
 */
export function resolveConnectContract(
  kind: ConnectKind,
  requestedUrl?: string | null
): ConnectContract {
  const available = kind === "shopping" || hasStoredConnectContract(kind);
  return buildConnectContract(kind, requestedUrl, {
    listAvailable: available,
    registrationAvailable: available,
  });
}
