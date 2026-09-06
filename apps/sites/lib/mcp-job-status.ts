/** Advisory only: never automatically replay a job that may have side effects. */
export function jobGuidance(status: string, errorCode: string | null, cancelRequested = false) {
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status);
  const uncertain = errorCode === 'AGENT_LOST_UNCERTAIN';
  return {
    terminal,
    mustContinue: !terminal,
    taskOutcome: status === 'SUCCEEDED' ? 'read_result_before_claiming_success' : terminal ? 'inspect_terminal_state' : 'pending',
    waitMs: terminal ? 0 : 20000,
    pollAfterMs: terminal ? null : 3000,
    nextAction: uncertain ? 'verify_published' : status === 'FAILED' ? 'inspect_failure' : status === 'CANCELLED' ? 'none' : terminal ? 'read_result' : 'poll',
    message: uncertain
      ? '발행 여부가 불확실합니다. post_verify_published로 확인한 뒤 재실행 여부를 결정하세요.'
      : status === 'FAILED'
        ? 'errorCode와 errorMessage를 확인하세요. 같은 idempotencyKey는 실패한 기존 작업을 반환합니다. 원인을 해결하고 부작용을 확인한 뒤 새 키로 요청하세요.'
        : cancelRequested && !terminal ? '취소 요청을 전달했습니다. 종료 상태가 확인될 때까지 job_get으로 확인하세요.'
          : !terminal ? '아직 완료되지 않았습니다. 같은 jobId로 job_get(waitMs=20000)을 계속 호출하세요. 오래 걸리거나 진행률이 같다는 이유만으로 종료·실패 판정·새 작업 생성하지 마세요.'
            : '결과를 읽고 사용자가 요청한 전체 단계가 완료됐는지 확인하세요. 컨텍스트 준비나 초안 저장 성공은 이미지·승인·발행 성공을 뜻하지 않습니다.',
  };
}

/** Bounded HTTP wait; expiration leaves the durable job pending, never failed. */
export async function waitForJob<T extends { status: string }>(
  read: () => Promise<T | null>, waitMs = 20000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let job = await read();
  let remaining = Math.min(20000, Math.max(0, waitMs));
  while (job && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status) && remaining > 0) {
    const interval = Math.min(2000, remaining);
    await sleep(interval);
    remaining -= interval;
    job = await read();
  }
  return job;
}

/** Pages are slices of serialized JSON; concatenate them before JSON.parse. */
export function resultPage(serialized: string | null, offset: number, limit: number) {
  const source = serialized ?? 'null';
  const text = source.slice(offset, offset + limit);
  const nextOffset = offset + text.length;
  return { encoding: 'json', offset, totalChars: source.length, text, nextOffset: nextOffset < source.length ? nextOffset : null, complete: nextOffset >= source.length };
}
