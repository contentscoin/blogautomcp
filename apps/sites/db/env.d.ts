declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    INSTALLERS: R2Bucket;
    INSTALLER_UPLOAD_KEY?: string;
    BUG_REPORT_TELEGRAM_BOT_TOKEN?: string;
    BUG_REPORT_TELEGRAM_CHAT_ID?: string;
  }
}
