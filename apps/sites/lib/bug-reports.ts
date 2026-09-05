import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { newId } from '@/lib/crypto';
import { enforceRateLimit } from '@/lib/rate-limit';

/** Never send raw environments, cookies, draft bodies, or arbitrary files. */
export function redactReport(value: string): string {
  return value
    .replace(/(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[REDACTED HEADER]')
    .replace(/(["']?(?:[\w-]*(?:token|secret|password|api[_-]?key)|NID_AUT|NID_SES)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[BOT TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[API KEY]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL REDACTED]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[USER]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/\b01[016789][- .]?\d{3,4}[- .]?\d{4}\b/g, '[PHONE]');
}

export interface BugReportInput {
  summary: string;
  details?: string;
  jobId?: string;
  idempotencyKey: string;
  confirmed: boolean;
}

type ReportRow = { id: string; summary: string; diagnostics_json: string; delivery_status: string; created_at: number };

export async function getBugReport(userId: string, reportId: string) {
  const report = await getD1().prepare('SELECT id,summary,diagnostics_json,delivery_status,created_at FROM bug_reports WHERE id=? AND user_id=?').bind(reportId, userId).first<ReportRow>();
  return report ? { ok: true, report: { id: report.id, summary: report.summary, deliveryStatus: report.delivery_status, createdAt: report.created_at } }
    : { ok: false, code: 'REPORT_NOT_FOUND' };
}

export async function createBugReport(userId: string, input: BugReportInput) {
  if (input.confirmed !== true) return { ok: false, code: 'CONFIRMATION_REQUIRED', message: '관리자와 텔레그램으로 오류 내용을 전달하는 데 사용자 동의가 필요합니다.' };
  const d1 = getD1();
  const existing = await d1.prepare('SELECT id,delivery_status FROM bug_reports WHERE user_id=? AND idempotency_key=?').bind(userId, input.idempotencyKey).first<{ id: string; delivery_status: string }>();
  if (existing) return { ok: true, reportId: existing.id, deliveryStatus: existing.delivery_status, reused: true };
  const limit = await enforceRateLimit(d1, `bug-report:${userId}`, 5, 3600000);
  if (!limit.allowed) return { ok: false, code: 'RATE_LIMITED', retryAfterMs: limit.retryAfterMs };
  const job = input.jobId ? await d1.prepare('SELECT id,type,status,error_code,error_message FROM agent_jobs WHERE id=? AND user_id=?').bind(input.jobId, userId).first<Record<string, string | null>>() : null;
  if (input.jobId && !job) return { ok: false, code: 'JOB_NOT_FOUND' };
  const device = await d1.prepare("SELECT app_version,platform FROM devices WHERE user_id=? AND status='ACTIVE' ORDER BY paired_at DESC LIMIT 1").bind(userId).first<Record<string, string | null>>();
  const summary = redactReport(input.summary).slice(0, 200);
  const diagnostics = JSON.stringify({ details: redactReport(input.details || '').slice(0, 8000), job: job ? Object.fromEntries(Object.entries(job).map(([key, value]) => [key, value ? redactReport(value).slice(0, 2000) : value])) : null, device });
  const id = newId('bug');
  const inserted = await d1.prepare('INSERT INTO bug_reports (id,user_id,idempotency_key,summary,diagnostics_json,delivery_status,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING').bind(id, userId, input.idempotencyKey, summary, diagnostics, 'PENDING', Date.now()).run();
  if (!inserted.meta.changes) {
    const winner = await d1.prepare('SELECT id,delivery_status FROM bug_reports WHERE user_id=? AND idempotency_key=?').bind(userId, input.idempotencyKey).first<{ id: string; delivery_status: string }>();
    return { ok: true, reportId: winner?.id, deliveryStatus: winner?.delivery_status, reused: true };
  }
  const config = env as unknown as Record<string, string | undefined>;
  const token = config.BUG_REPORT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = config.BUG_REPORT_TELEGRAM_CHAT_ID?.trim();
  let deliveryStatus = 'NOT_CONFIGURED';
  if (token && chatId) {
    try {
      const text = `블로그오토 오류 리포트\n접수: ${id}\n계정: ${userId}\n${summary}\n${diagnostics}`;
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900), link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json() as { ok?: boolean };
      deliveryStatus = response.ok && body.ok === true ? 'SENT' : 'FAILED';
    } catch { deliveryStatus = 'FAILED'; } // Fetch errors may contain the bot token URL.
  }
  await d1.prepare('UPDATE bug_reports SET delivery_status=? WHERE id=? AND user_id=?').bind(deliveryStatus, id, userId).run();
  return { ok: true, reportId: id, deliveryStatus, message: deliveryStatus === 'SENT' ? '오류 리포트를 저장하고 텔레그램으로 전달했습니다.' : '오류 리포트는 저장됐지만 텔레그램 전달은 완료되지 않았습니다.' };
}
