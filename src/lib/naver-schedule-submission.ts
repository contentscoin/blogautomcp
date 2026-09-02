export interface NaverScheduleSubmissionSignal {
  relevant: boolean;
  successfulResponse: boolean;
  hasTargetDate: boolean;
  hasScheduleMode: boolean;
  confirmed: boolean;
}

function decodePayload(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function inspectNaverScheduleSubmissionSignal(input: {
  url: string;
  postData: string;
  status: number;
  targetYmd: string;
}): NaverScheduleSubmissionSignal {
  const lowerUrl = input.url.toLowerCase();
  const decodedPayload = decodePayload(input.postData).replace(/\\u([0-9a-f]{4})/gi, (_, code) =>
    String.fromCharCode(Number.parseInt(code, 16))
  );
  const compactPayload = decodedPayload.replace(/\s+/g, "").toLowerCase();
  const dotted = input.targetYmd.replace(/-/g, ".");
  const slashed = input.targetYmd.replace(/-/g, "/");
  const compact = input.targetYmd.replace(/-/g, "");

  const relevant =
    lowerUrl.includes("naver.com") &&
    /write|publish|post|reserve|reservation|schedule|save|rabbit/i.test(lowerUrl);
  const successfulResponse = input.status >= 200 && input.status < 400;
  const hasTargetDate =
    compactPayload.includes(input.targetYmd) ||
    compactPayload.includes(dotted) ||
    compactPayload.includes(slashed) ||
    compactPayload.includes(compact);
  const hasScheduleMode =
    /reserve|reservation|schedule|pretime|pre_date|predate|pre_post|prepost|reservedtime/.test(
      `${lowerUrl} ${compactPayload}`
    ) ||
    /radio_time(?:%22|["'=:\s])+pre/.test(compactPayload) ||
    /publish(?:mode|type)(?:%22|["'=:\s])+(?:reserve|schedule|pre)/.test(compactPayload);

  return {
    relevant,
    successfulResponse,
    hasTargetDate,
    hasScheduleMode,
    confirmed: relevant && successfulResponse && hasTargetDate && hasScheduleMode,
  };
}
