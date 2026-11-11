declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    INSTALLERS: R2Bucket;
    INSTALLER_UPLOAD_KEY?: string;
    BLOGAUTO_PUBLIC_PLUGIN_INSTALL_URL?: string;
    BLOGAUTO_PUBLIC_PLUGIN_APPROVED?: string;
    OPENAI_APPS_DOMAIN_CHALLENGE?: string;
    BUG_REPORT_TELEGRAM_BOT_TOKEN?: string;
    BUG_REPORT_TELEGRAM_CHAT_ID?: string;
  }
}
