"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="button small" disabled={busy} onClick={async () => { setBusy(true); await fetch("/api/auth/logout", { method: "POST" }); router.replace("/"); router.refresh(); }}>{busy ? "종료 중…" : "로그아웃"}</button>;
}
