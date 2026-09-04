/** Advisory only: never automatically replay a job that may have side effects. */
export function jobGuidance(status: string, errorCode: string | null, cancelRequested = false) {
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status);
  const uncertain = errorCode === 'AGENT_LOST_UNCERTAIN';
  return {
    terminal,
    pollAfterMs: terminal ? null : 3000,
    nextAction: uncertain ? 'verify_published' : status === 'FAILED' ? 'inspect_failure' : status === 'CANCELLED' ? 'none' : terminal ? 'read_result' : 'poll',
    message: uncertain
      ? '발행 여부가 불확실합니다. post_verify_published로 확인한 뒤 재실행 여부를 결정하세요.'
      : status === 'FAILED'
        ? 'errorCode와 errorMessage를 확인하세요. 같은 idempotencyKey는 실패한 기존 작업을 반환합니다. 원인을 해결하고 부작용을 확인한 뒤 새 키로 요청하세요.'
        : cancelRequested && !terminal ? '취소 요청을 전달했습니다. 종료 상태가 확인될 때까지 job_get으로 확인하세요.' : null,
  };
}

/** Pages are slices of serialized JSON; concatenate them before JSON.parse. */
export function resultPage(serialized: string | null, offset: number, limit: number) {
  const source = serialized ?? 'null';
  const text = source.slice(offset, offset + limit);
  const nextOffset = offset + text.length;
  return { encoding: 'json', offset, totalChars: source.length, text, nextOffset: nextOffset < source.length ? nextOffset : null, complete: nextOffset >= source.length };
}
