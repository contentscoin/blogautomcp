/**
 * 재시도 로직 유틸리티
 * V4 Phase 8: 에러 핸들링 강화
 */

import { createTaskLogger } from "./logger";

const log = createTaskLogger("Retry");

interface RetryOptions {
    maxRetries?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (error: Error, attempt: number) => void;
}

const defaultOptions: Required<RetryOptions> = {
    maxRetries: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
    onRetry: () => { },
};

/**
 * 재시도 로직 래퍼
 * Exponential backoff 적용
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...defaultOptions, ...options };
    let lastError: Error = new Error("Unknown error");

    for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt === opts.maxRetries) {
                log.error(`모든 재시도 실패 (${opts.maxRetries}회)`, lastError);
                throw lastError;
            }

            const delay = opts.delayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
            log.warn(`시도 ${attempt}/${opts.maxRetries} 실패, ${delay}ms 후 재시도`, { error: lastError.message });

            opts.onRetry(lastError, attempt);

            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * 타임아웃 래퍼
 */
export async function withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    errorMessage = "작업 타임아웃"
): Promise<T> {
    return Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        ),
    ]);
}

/**
 * 안전 실행 - 에러 발생 시 기본값 반환
 */
export async function safeExecute<T>(
    fn: () => Promise<T>,
    fallback: T,
    errorHandler?: (error: Error) => void
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (errorHandler) {
            errorHandler(err);
        } else {
            log.warn(`안전 실행 폴백 사용`, { error: err.message });
        }
        return fallback;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export { sleep };
