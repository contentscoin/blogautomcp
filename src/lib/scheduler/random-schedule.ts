/**
 * 랜덤 스케줄 생성 모듈
 * 09:00 ~ 18:00(KST) 사이에 5개의 랜덤 발행 시간 생성
 */

import { kstWallClockToInstant, getKstParts } from "@/lib/kst";

export interface ScheduleConfig {
  startHour: number;  // 시작 시간 (기본 9)
  endHour: number;    // 종료 시간 (기본 18)
  postCount: number;  // 글 개수 (기본 5)
  minGapMinutes: number; // 최소 간격 (분, 기본 30)
}

const DEFAULT_CONFIG: ScheduleConfig = {
  startHour: 9,
  endHour: 18,
  postCount: 5,
  minGapMinutes: 30,
};

/**
 * 주어진 날짜에 대해 랜덤 발행 시간 배열 생성
 * @param date 대상 날짜
 * @param config 스케줄 설정
 * @returns 정렬된 발행 시간 배열
 */
export function generateRandomSchedule(
  date: Date,
  config: Partial<ScheduleConfig> = {}
): Date[] {
  const { startHour, endHour, postCount, minGapMinutes } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const totalMinutes = (endHour - startHour) * 60;
  const times: number[] = [];
  
  // 최대 시도 횟수 (무한 루프 방지)
  let attempts = 0;
  const maxAttempts = 1000;

  while (times.length < postCount && attempts < maxAttempts) {
    attempts++;
    const randomMinute = Math.floor(Math.random() * totalMinutes);

    // 기존 시간들과 최소 간격 확인
    const isValid = times.every(
      (t) => Math.abs(t - randomMinute) >= minGapMinutes
    );

    if (isValid) {
      times.push(randomMinute);
    }
  }

  // 최소 간격 제약으로 요청 개수를 못 채웠으면 조용히 누락하지 않고 경고한다.
  if (times.length < postCount) {
    console.warn(
      `[random-schedule] 요청 ${postCount}개 중 ${times.length}개만 생성됨 ` +
        `(윈도우 ${endHour - startHour}h, 최소간격 ${minGapMinutes}분 제약). ` +
        `윈도우를 넓히거나 minGapMinutes/postCount를 조정하세요.`
    );
  }

  // 대상 날짜를 KST 기준으로 해석해, 서버 타임존과 무관하게 KST 벽시계 시각을 만든다.
  const { year, month, day } = getKstParts(date);

  // 시간순 정렬 후 Date(instant)로 변환
  return times.sort((a, b) => a - b).map((minutes) => {
    const hour = startHour + Math.floor(minutes / 60);
    const minute = minutes % 60;
    const second = Math.floor(Math.random() * 60); // 초도 랜덤
    return kstWallClockToInstant(year, month, day, hour, minute, second);
  });
}

/**
 * 오늘 날짜 기준 랜덤 스케줄 생성
 */
export function generateTodaySchedule(
  config: Partial<ScheduleConfig> = {}
): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return generateRandomSchedule(today, config);
}

/**
 * 내일 날짜 기준 랜덤 스케줄 생성
 */
export function generateTomorrowSchedule(
  config: Partial<ScheduleConfig> = {}
): Date[] {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return generateRandomSchedule(tomorrow, config);
}

/**
 * 스케줄 시간을 사람이 읽기 쉬운 형식으로 포맷
 */
export function formatSchedule(times: Date[]): string[] {
  return times.map((time) =>
    time.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  );
}

