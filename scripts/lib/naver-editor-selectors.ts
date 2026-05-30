/**
 * 네이버 스마트에디터 ONE 셀렉터 — 단일 패치 지점(centralized).
 *
 * simple-agent.ts(5269줄)에 흩어진 발행 경로 셀렉터를 한곳에 모았다. 네이버가 빌드를
 * 새로 배포해 셀렉터가 깨지면, 이 파일 한 곳만 고치면 되도록 의도한 것이다.
 *
 * 안정성 등급(견고한 것부터):
 *   1. stable   — data-testid / data-name / id / name / se-* 컴포넌트 클래스 (빌드 무관, 1순위)
 *   2. semi     — class*="prefix" (해시 접미사 제외한 접두사 매칭, 비교적 안정)
 *   3. volatile — 해시 클래스(confirm_btn__WEaBq 등). 빌드마다 바뀜 → 최후 폴백으로만.
 *   4. coord    — 절대좌표 클릭. viewport(EDITOR_VIEWPORT) 고정 가정 → 정말 최후 수단.
 *
 * NOTE: 이 모듈은 추가용(additive)이다. 라이브 네이버 DOM 검증(inspect-editor-selectors.ts)
 *       후 simple-agent.ts를 점진적으로 이 상수로 전환할 것. 값은 현재 코드와 동일하게 유지.
 */

import type { Page } from "playwright";

/** simple-agent가 발행 시 사용하는 고정 viewport. 좌표 폴백의 기준. */
export const EDITOR_VIEWPORT = { width: 1280, height: 900 } as const;

export interface SelectorSpec {
  /** 1순위 안정 셀렉터(있으면 거의 항상 이걸로 충분). */
  stable: readonly string[];
  /** class*= 접두사 등 준안정 폴백. */
  semi?: readonly string[];
  /** 해시 클래스 등 빌드 종속 최후 폴백. */
  volatile?: readonly string[];
  /** 좌표 폴백(EDITOR_VIEWPORT 기준). */
  coord?: readonly { x: number; y: number }[];
  /** 텍스트 기반 식별이 필요한 경우의 양성 텍스트. */
  text?: readonly string[];
}

export const EDITOR_SELECTORS = {
  /** "작성 중인 글이 있습니다" 팝업의 취소(=새 글 진행) 버튼. */
  draftPopupCancel: ".se-popup-button-cancel",

  /** 제목 입력 영역. (라이브 확인: .se-documentTitle는 data-a11y-title="제목" 보유) */
  title: {
    stable: [
      ".se-documentTitle .se-text-paragraph",
      '.se-documentTitle[data-a11y-title="제목"]',
      ".se-documentTitle",
    ],
    coord: [{ x: 640, y: 130 }],
  } satisfies SelectorSpec,

  /** 본문 이미지 업로드 트리거(이후 filechooser 이벤트). 라이브 확인: data-log="dot.img". */
  imageButton: {
    stable: ['button[data-name="image"][data-log="dot.img"]', 'button[data-name="image"]'],
  } satisfies SelectorSpec,

  /**
   * 상단 헤더의 1차 "발행" 버튼(클릭 시 발행 설정 레이어가 열림, 발행 아님).
   * 라이브 확인(2026-05): 해시클래스 publish_btn__m9KHH지만 data-click-area="tpb.publish"가
   * 안정적이라 이를 1순위로 둔다.
   */
  headerPublishButton: {
    stable: ['button[data-click-area="tpb.publish"]'],
    semi: ['button[class*="publish_btn"]', 'header button[class*="publish"]'],
    coord: [{ x: 1210, y: 22 }],
  } satisfies SelectorSpec,

  /**
   * 발행 설정 레이어 내부의 최종 제출 버튼.
   * 라이브 확인(2026-05): data-testid="seOnePublishBtn" + data-click-area="tpb*i.publish"가
   * 안정적. 해시클래스 confirm_btn__WEaBq도 현재 빌드엔 유효하나 최후 폴백으로만 둔다.
   */
  finalPublishButton: {
    stable: ['button[data-testid="seOnePublishBtn"]', 'button[data-click-area="tpb*i.publish"]'],
    semi: ['button[class*="confirm_btn"]', 'button[class*="btn_publish"]'],
    volatile: ["button.confirm_btn__WEaBq", "button.btn_publish__FvD4K"],
    coord: [
      { x: 480, y: 455 },
      { x: 470, y: 450 },
    ],
    text: ["예약발행", "예약등록", "예약완료", "발행", "등록", "확인", "완료"],
  } satisfies SelectorSpec,

  /** 예약 발행 라디오("예약"). 라이브 확인: id=radio_time2, data-click-area="tpb*i.schedule". */
  scheduleReserveRadio: {
    stable: [
      'input[data-testid="preTimeRadioBtn"]',
      'input[name="radio_time"][value="pre"]',
      "input#radio_time2",
      'input[data-click-area="tpb*i.schedule"]',
    ],
  } satisfies SelectorSpec,

  /** 즉시 발행 라디오("현재"). 라이브 확인: id=radio_time1, data-click-area="tpb*i.now". */
  scheduleNowRadio: {
    stable: [
      'input[data-testid="nowTimeRadioBtn"]',
      'input[name="radio_time"][value="now"]',
      "input#radio_time1",
      'input[data-click-area="tpb*i.now"]',
    ],
  } satisfies SelectorSpec,

  /**
   * 예약 날짜/시간 입력(예약 라디오 선택 후에만 렌더됨).
   * ⚠️ 라이브 확인(2026-05): 이 컨트롤들은 data-testid/id가 없고 해시 클래스뿐이라
   *    발행 경로에서 가장 취약하다. class 접두사 매칭이 그나마 안정적.
   */
  scheduleDateInput: {
    stable: [],
    semi: ['input[class*="input_date"]'],
    volatile: ["input.input_date__QmA0s"],
  } satisfies SelectorSpec,
  scheduleHourSelect: {
    stable: [],
    semi: ['select[class*="hour_option"]'],
    volatile: ["select.hour_option__J_heO"],
  } satisfies SelectorSpec,
  scheduleMinuteSelect: {
    stable: [],
    semi: ['select[class*="minute_option"]'],
    volatile: ["select.minute_option__Vb3xB"],
  } satisfies SelectorSpec,

  /** 도움말/가이드 레이어 닫기 버튼들. */
  helpCloseButtons: [
    '.help_layer button[class*="close"]',
    '.tooltip button[class*="close"]',
    '.guide_layer button[class*="close"]',
    '[class*="close_btn"]',
    '[class*="closeBtn"]',
    'button[aria-label="닫기"]',
    ".se-help-panel-close-button",
  ] as readonly string[],
} as const;

/** 최종 발행 버튼 스코어링 시 제외할 텍스트(취소/임시저장 등 오클릭 방지). */
export const FINAL_PUBLISH_NEGATIVE_TEXT =
  /(취소|닫기|도움말|가이드|이전|뒤로|임시|저장|목록|관리|내역|설정|cancel|close)/i;

/** 로그인 페이지로 튕겼는지(세션 만료) 판정. */
export function isLoginRedirect(url: string): boolean {
  return /nid\.naver\.com|nidlogin|\/login\b/i.test(url);
}

/** 주어진 셀렉터 목록에서 처음으로 "보이는" 것을 반환(없으면 null). */
export async function firstVisibleSelector(
  page: Page,
  selectors: readonly string[]
): Promise<string | null> {
  for (const sel of selectors) {
    const visible = await page
      .locator(sel)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return sel;
  }
  return null;
}

export interface EditorReadiness {
  ok: boolean;
  loggedOut: boolean;
  url: string;
  /** 발견된 핵심 앵커: 매칭된 셀렉터(없으면 null). */
  found: { title: string | null; imageButton: string | null };
  missing: string[];
}

/**
 * 발행 시작 전 에디터 상태 헬스체크.
 * 세션 만료(로그인 리다이렉트)나 핵심 앵커(제목/이미지) 부재를 조기에 명확히 잡아내,
 * 깊은 단계에서의 모호한 실패 대신 "세션 만료/UI 변경"으로 빠르게 실패시키는 용도.
 *
 * (현재는 inspect-editor-selectors.ts가 소비. 라이브 검증 후 simple-agent STEP3/STEP7
 *  진입부에 도입 예정.)
 */
export async function checkEditorReady(page: Page): Promise<EditorReadiness> {
  const url = page.url();
  const loggedOut = isLoginRedirect(url);

  const title = await firstVisibleSelector(page, EDITOR_SELECTORS.title.stable);
  const imageButton = await firstVisibleSelector(page, EDITOR_SELECTORS.imageButton.stable);

  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!imageButton) missing.push("imageButton");

  return {
    ok: !loggedOut && missing.length === 0,
    loggedOut,
    url,
    found: { title, imageButton },
    missing,
  };
}
