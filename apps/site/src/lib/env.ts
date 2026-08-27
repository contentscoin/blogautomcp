const FIXED_ADMIN_EMAIL = "hiway@kakao.com";

export function getAdminEmail(): string {
  const configured = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (configured && configured !== FIXED_ADMIN_EMAIL) {
    throw new Error(`ADMIN_EMAIL must remain ${FIXED_ADMIN_EMAIL}.`);
  }
  return FIXED_ADMIN_EMAIL;
}

export function getSiteUrl(): string {
  const value = process.env.SITE_URL?.trim() || "http://localhost:3100";
  return value.replace(/\/$/, "");
}

export function getAuthSecret(): string {
  const value = process.env.SITE_AUTH_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("SITE_AUTH_SECRET must contain at least 32 characters.");
  }
  return value;
}

export function getAdminBootstrapCode(): string {
  const value = process.env.ADMIN_BOOTSTRAP_CODE?.trim();
  if (!value || value.length < 16) {
    throw new Error("ADMIN_BOOTSTRAP_CODE must contain at least 16 characters.");
  }
  return value;
}
