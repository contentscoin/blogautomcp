import "dotenv/config";
import fs from "fs";
import path from "path";

export interface CompletionLink {
  label: string;
  url?: string | null;
  description?: string | null;
  scheduledDate?: string | null;
  status?: string | null;
}

export interface CompletionNotification {
  taskType: string;
  title: string;
  summary: string;
  successCount?: number;
  failedCount?: number;
  dashboardPath?: string;
  links?: CompletionLink[];
  extra?: Record<string, unknown>;
}

export interface CompletionNotificationResult {
  sent: boolean;
  reason?: string;
  status?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const TELEGRAM_MESSAGE_MAX_LENGTH = 3600;
const TELEGRAM_REASON_LIMIT = 5;

function readEnvFileValue(name: string): string | null {
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return null;

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = fs
      .readFileSync(envPath, "utf8")
      .match(new RegExp(`^${escapedName}=(.*)$`, "m"));
    if (!match) return null;

    const value = match[1].trim().replace(/^"|"$/g, "").trim();
    return value || null;
  } catch {
    return null;
  }
}

function firstConfigured(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;

    const fileValue = readEnvFileValue(name);
    if (fileValue) return fileValue;
  }
  return null;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = firstConfigured(name)?.toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getCompletionBaseUrl(): string {
  const configured = firstConfigured(
    "CHATBOT_COMPLETION_BASE_URL",
    "NEXT_PUBLIC_APP_URL",
    "APP_BASE_URL"
  );

  if (configured) {
    return trimTrailingSlash(configured);
  }

  const host = firstConfigured("APP_HOST") || "127.0.0.1";
  const port = firstConfigured("APP_PORT") || "3000";
  return `http://${host}:${port}`;
}

export function buildAppUrl(pathname = "/"): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getCompletionBaseUrl()}${normalizedPath}`;
}

function getWebhookUrl(): string | null {
  return firstConfigured(
    "CHATBOT_WEBHOOK_URL",
    "HERMES_WEBHOOK_URL",
    "COMPLETION_WEBHOOK_URL"
  );
}

function getTelegramBotToken(): string | null {
  return firstConfigured("TELEGRAM_BOT_TOKEN", "CHATBOT_TELEGRAM_BOT_TOKEN");
}

function isFailureLink(link: CompletionLink): boolean {
  const status = (link.status || "").toUpperCase();
  return status.includes("FAIL") || status === "ERROR";
}

function normalizeReason(value?: string | null): string {
  const reason = (value || "사유 미기록").replace(/\s+/g, " ").trim();
  return reason || "사유 미기록";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeReportSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "completion";
}

function getFailureReasonRows(failedLinks: CompletionLink[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();

  for (const link of failedLinks) {
    const reason = truncateText(normalizeReason(link.description), 160);
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function buildCompletionReportHtml(
  input: CompletionNotification,
  dashboardUrl: string,
  createdAt: string
): string {
  const links = input.links ?? [];
  const failedLinks = links.filter(isFailureLink);
  const completedLinks = links.filter((link) => !isFailureLink(link));
  const reasonRows = getFailureReasonRows(failedLinks);
  const rows = links
    .map((link, index) => {
      const failed = isFailureLink(link);
      const url = link.url
        ? `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.url)}</a>`
        : "-";
      return [
        "<tr>",
        `<td>${index + 1}</td>`,
        `<td><span class="badge ${failed ? "failed" : "success"}">${escapeHtml(link.status || (failed ? "FAILED" : "DONE"))}</span></td>`,
        `<td>${escapeHtml(link.scheduledDate || "-")}</td>`,
        `<td>${escapeHtml(link.label || "이름 없는 항목")}</td>`,
        `<td>${escapeHtml(normalizeReason(link.description))}</td>`,
        `<td class="url">${url}</td>`,
        "</tr>",
      ].join("");
    })
    .join("\n");
  const reasonHtml = reasonRows.length
    ? `<ul>${reasonRows
        .map((row) => `<li><strong>${row.count}건</strong> ${escapeHtml(row.reason)}</li>`)
        .join("")}</ul>`
    : "<p>실패 항목이 없습니다.</p>";
  const extraHtml =
    input.extra && Object.keys(input.extra).length > 0
      ? `<pre>${escapeHtml(JSON.stringify(input.extra, null, 2))}</pre>`
      : "<p>추가 정보가 없습니다.</p>";

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)} 작업 리포트</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 17px; margin: 28px 0 10px; }
    p { margin: 6px 0; line-height: 1.55; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 18px 0; }
    .metric { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    .metric strong { display: block; font-size: 22px; }
    .panel { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 920px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; text-align: left; vertical-align: top; font-size: 13px; }
    th { position: sticky; top: 0; background: #f1f5f9; z-index: 1; }
    .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .badge.success { background: #dcfce7; color: #166534; }
    .badge.failed { background: #fee2e2; color: #991b1b; }
    .url { word-break: break-all; max-width: 340px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(input.title)}</h1>
    <p>${escapeHtml(input.summary)}</p>
    <p>생성 시각: ${escapeHtml(createdAt)}</p>
    <p>대시보드: <a href="${escapeHtml(dashboardUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(dashboardUrl)}</a></p>
    <section class="summary">
      <div class="metric"><span>전체</span><strong>${links.length}</strong></div>
      <div class="metric"><span>성공</span><strong>${input.successCount ?? completedLinks.length}</strong></div>
      <div class="metric"><span>실패</span><strong>${input.failedCount ?? failedLinks.length}</strong></div>
    </section>
    <h2>실패 사유 요약</h2>
    <section class="panel">${reasonHtml}</section>
    <h2>상세 리스트</h2>
    <section class="panel">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>상태</th>
            <th>예약일</th>
            <th>항목</th>
            <th>설명/사유</th>
            <th>링크</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6">표시할 항목이 없습니다.</td></tr>`}
        </tbody>
      </table>
    </section>
    <h2>추가 정보</h2>
    <section class="panel">${extraHtml}</section>
  </main>
</body>
</html>`;
}

function persistCompletionReport(
  input: CompletionNotification,
  dashboardUrl: string,
  createdAt: string
): { reportPath: string; reportUrl: string } {
  const reportDir = path.join(process.cwd(), "public", "completion-reports");
  fs.mkdirSync(reportDir, { recursive: true });

  const stamp = createdAt.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const fileName = `${stamp}-${safeReportSlug(input.taskType)}-${safeReportSlug(input.title)}.html`;
  const reportPath = path.join(reportDir, fileName);
  fs.writeFileSync(reportPath, buildCompletionReportHtml(input, dashboardUrl, createdAt), "utf8");

  return {
    reportPath,
    reportUrl: buildAppUrl(`/completion-reports/${encodeURIComponent(fileName)}`),
  };
}

function buildMessage(input: CompletionNotification, dashboardUrl: string, reportUrl: string): string {
  const links = input.links ?? [];
  const failedLinks = links.filter(isFailureLink);
  const countLine =
    typeof input.successCount === "number" || typeof input.failedCount === "number"
      ? `성공 ${input.successCount ?? 0}건 / 실패 ${input.failedCount ?? 0}건`
      : null;
  const allReasonRows = getFailureReasonRows(failedLinks);
  const reasonRows = allReasonRows.slice(0, TELEGRAM_REASON_LIMIT);
  const hiddenReasonCount = Math.max(0, allReasonRows.length - reasonRows.length);

  return [
    `[작업완료] ${input.title}`,
    input.summary,
    countLine,
    `상세 HTML: ${reportUrl}`,
    `대시보드: ${dashboardUrl}`,
    failedLinks.length > 0 ? "실패 사유 요약:" : null,
    ...reasonRows.map((row) => `- ${row.reason}: ${row.count}건`),
    hiddenReasonCount > 0 ? `- 외 ${hiddenReasonCount}개 유형은 HTML에서 확인` : null,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}

function persistTelegramChatId(chatId: string): void {
  const envPath = path.join(process.cwd(), ".env");
  try {
    if (!fs.existsSync(envPath)) return;

    const current = fs.readFileSync(envPath, "utf8");
    const existing = current.match(/^TELEGRAM_CHAT_ID=(.*)$/m);
    if (existing && existing[1].replace(/^"|"$/g, "").trim()) {
      return;
    }

    const next = existing
      ? current.replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID="${chatId}"`)
      : `${current.replace(/\s*$/, "")}\nTELEGRAM_CHAT_ID="${chatId}"\n`;

    fs.writeFileSync(envPath, next, "utf8");
  } catch {
    // Persistence is only a convenience. Sending can continue with the resolved chat id.
  }
}

function extractTelegramChatId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) return null;

  for (let index = result.length - 1; index >= 0; index -= 1) {
    const update = result[index];
    if (!update || typeof update !== "object") continue;
    const candidates = [
      (update as { message?: unknown }).message,
      (update as { channel_post?: unknown }).channel_post,
      (update as { edited_message?: unknown }).edited_message,
      (update as { edited_channel_post?: unknown }).edited_channel_post,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const chat = (candidate as { chat?: unknown }).chat;
      if (!chat || typeof chat !== "object") continue;
      const id = (chat as { id?: unknown }).id;
      if (typeof id === "number" || typeof id === "string") {
        return String(id);
      }
    }
  }

  return null;
}

async function resolveTelegramChatId(
  token: string,
  signal: AbortSignal
): Promise<string | null> {
  const configured = firstConfigured("TELEGRAM_CHAT_ID", "CHATBOT_TELEGRAM_CHAT_ID");
  if (configured) return configured;

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: "GET",
    signal,
  });
  if (!response.ok) return null;

  const chatId = extractTelegramChatId(await response.json());
  if (chatId) {
    persistTelegramChatId(chatId);
  }
  return chatId;
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    const safeLine =
      line.length > TELEGRAM_MESSAGE_MAX_LENGTH
        ? `${line.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH - 20)}...`
        : line;
    const candidate = current ? `${current}\n${safeLine}` : safeLine;

    if (candidate.length > TELEGRAM_MESSAGE_MAX_LENGTH) {
      if (current) chunks.push(current);
      current = safeLine;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function sendTelegramCompletion(
  token: string,
  text: string,
  signal: AbortSignal
): Promise<CompletionNotificationResult> {
  const chatId = await resolveTelegramChatId(token, signal);
  if (!chatId) {
    return { sent: false, reason: "telegram-chat-id-not-found" };
  }

  const chunks = splitTelegramMessage(text);
  let lastStatus = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkText =
      chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunks[index]}` : chunks[index];

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: chunkText,
        disable_web_page_preview: false,
      }),
    });

    lastStatus = response.status;

    if (!response.ok) {
      return { sent: false, reason: `telegram-http-${response.status}`, status: response.status };
    }
  }

  return { sent: true, status: lastStatus };
}

export async function sendChatbotCompletionNotification(
  input: CompletionNotification
): Promise<CompletionNotificationResult> {
  if (!envFlag("CHATBOT_NOTIFY_COMPLETION", true)) {
    return { sent: false, reason: "disabled" };
  }

  if (envFlag("CHATBOT_SUPPRESS_AGENT_NOTIFY", false)) {
    return { sent: false, reason: "suppressed" };
  }

  const dashboardUrl = buildAppUrl(input.dashboardPath ?? "/");
  const createdAt = new Date().toISOString();
  const report = persistCompletionReport(input, dashboardUrl, createdAt);
  const text = buildMessage(input, dashboardUrl, report.reportUrl);
  const timeoutMs = Number.parseInt(firstConfigured("CHATBOT_WEBHOOK_TIMEOUT_MS") || "", 10);
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) {
      const telegramToken = getTelegramBotToken();
      if (telegramToken) {
        return await sendTelegramCompletion(telegramToken, text, controller.signal);
      }
      return { sent: false, reason: "webhook-not-configured" };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const token = firstConfigured("CHATBOT_WEBHOOK_TOKEN", "HERMES_WEBHOOK_TOKEN");
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        event: "brandconnect.task.completed",
        taskType: input.taskType,
        title: input.title,
        summary: input.summary,
        text,
        message: text,
        content: text,
        dashboardUrl,
        reportUrl: report.reportUrl,
        reportPath: report.reportPath,
        successCount: input.successCount,
        failedCount: input.failedCount,
        links: input.links ?? [],
        extra: input.extra ?? {},
        createdAt,
      }),
    });

    if (!response.ok) {
      return { sent: false, reason: `http-${response.status}`, status: response.status };
    }

    return { sent: true, status: response.status };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { sent: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyAndLogCompletion(
  input: CompletionNotification
): Promise<void> {
  const result = await sendChatbotCompletionNotification(input);
  if (result.sent) {
    console.log("챗봇 작업완료 메시지 전송 완료");
    return;
  }

  if (result.reason === "webhook-not-configured") {
    console.log("챗봇 웹훅 미설정: 작업완료 메시지 전송 생략");
    return;
  }

  if (result.reason === "disabled" || result.reason === "suppressed") {
    return;
  }

  console.warn(`챗봇 작업완료 메시지 전송 실패: ${result.reason}`);
}
