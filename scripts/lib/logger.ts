/**
 * 로깅 시스템 - Winston 기반
 * V4 Phase 8: 안정성 강화
 */

import winston from "winston";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");

// 로그 포맷
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
        let log = `${timestamp} [${level.toUpperCase()}] ${message}`;
        if (Object.keys(meta).length > 0) {
            log += ` ${JSON.stringify(meta)}`;
        }
        if (stack) {
            log += `\n${stack}`;
        }
        return log;
    })
);

// 콘솔용 컬러 포맷
const consoleFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: "HH:mm:ss" }),
    winston.format.printf(({ level, message, timestamp }) => {
        return `${timestamp} ${level}: ${message}`;
    })
);

// 로거 생성
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: logFormat,
    transports: [
        // 콘솔 출력
        new winston.transports.Console({
            format: consoleFormat,
        }),
        // 에러 로그 파일
        new winston.transports.File({
            filename: path.join(LOG_DIR, "error.log"),
            level: "error",
        }),
        // 전체 로그 파일
        new winston.transports.File({
            filename: path.join(LOG_DIR, "combined.log"),
        }),
    ],
});

// 작업별 로거 생성
export function createTaskLogger(taskName: string) {
    return {
        info: (message: string, meta?: object) =>
            logger.info(`[${taskName}] ${message}`, meta),
        error: (message: string, error?: Error | object) =>
            logger.error(`[${taskName}] ${message}`, error instanceof Error ? { stack: error.stack } : error),
        warn: (message: string, meta?: object) =>
            logger.warn(`[${taskName}] ${message}`, meta),
        debug: (message: string, meta?: object) =>
            logger.debug(`[${taskName}] ${message}`, meta),
    };
}

export default logger;
