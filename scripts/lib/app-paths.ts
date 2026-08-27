/**
 * 앱 경로 해석 — 개발/패키징 공용.
 *
 * 패키징 데스크톱 앱은 설치 경로가 읽기 전용이므로, 세션 저장소와 사용자 설정(.env)을
 * 쓰기 가능한 userData로 보낸다. main.cjs가 다음 환경변수를 주입한다:
 *   - DESKTOP_USER_DATA: Electron userData 절대경로
 *   - SESSION_STORAGE_DIR: playwright 세션 저장 디렉터리(userData 하위)
 *   - DESKTOP_PROJECT_ROOT: 번들된 앱 루트
 * 개발 모드에서는 환경변수가 없으므로 프로젝트 기준 경로를 쓴다(기존 동작 유지).
 */

import * as path from "path";

/** 앱 루트(스크립트/리소스 기준). 패키징 시 번들 루트, 개발 시 cwd. */
export function getProjectRoot(): string {
  return process.env.DESKTOP_PROJECT_ROOT || process.cwd();
}

/** playwright 세션 저장 디렉터리. 패키징 시 userData/playwright/storage. */
export function getSessionStorageDir(): string {
  return (
    process.env.SESSION_STORAGE_DIR || path.join(getProjectRoot(), "playwright", "storage")
  );
}

/**
 * 네이버 세션 storageState 파일 경로.
 * NAVER_STORAGE_STATE_PATH가 있으면 그것을 우선한다(API 라우트가 스크립트에
 * `--storage-state=`로 넘기는 값과 같은 경로가 되도록 한 곳에서만 계산한다).
 */
export function getNaverSessionFile(): string {
  const configured = process.env.NAVER_STORAGE_STATE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(getSessionStorageDir(), "naver-session.json");
}

/** ChatGPT 세션 storageState 파일 경로. */
export function getChatgptSessionFile(): string {
  return path.join(getSessionStorageDir(), "chatgpt-session.json");
}

/** 쓰기 가능한 사용자 데이터 루트. 패키징 시 userData, 개발 시 프로젝트 루트. */
export function getUserDataRoot(): string {
  return process.env.DESKTOP_USER_DATA || getProjectRoot();
}

/** 사용자 설정(.env) 파일 경로. 패키징 시 userData/.env, 개발 시 프로젝트 .env. */
export function getEnvFilePath(): string {
  return path.join(getUserDataRoot(), ".env");
}

/**
 * 앱이 생성하는 상태 파일 디렉터리(커넥트 계약 등).
 * 설치 경로는 읽기 전용일 수 있으므로 반드시 userData 아래를 쓴다.
 */
export function getAppDataDir(): string {
  return path.join(getUserDataRoot(), "data");
}

/** 앱이 남기는 로그 디렉터리. 패키징 시 userData/logs. */
export function getLogsDir(): string {
  return path.join(getUserDataRoot(), "logs");
}
