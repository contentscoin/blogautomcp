declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    INSTALLERS: R2Bucket;
    INSTALLER_UPLOAD_KEY?: string;
  }
}
