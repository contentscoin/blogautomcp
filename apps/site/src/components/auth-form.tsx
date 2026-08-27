"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.message || "로그인하지 못했습니다.");
      setBusy(false);
      return;
    }
    const returnTo = search.get("returnTo");
    router.replace(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="email">이메일</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label htmlFor="password">비밀번호</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {error ? <div className="notice error">{error}</div> : null}
      <button className="button primary" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isAdminEmail, setIsAdminEmail] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: form.get("displayName"),
        email: form.get("email"),
        password: form.get("password"),
        adminBootstrapCode: form.get("adminBootstrapCode"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.message || "가입 신청을 완료하지 못했습니다.");
      setBusy(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="displayName">이름</label><input className="input" id="displayName" name="displayName" minLength={2} maxLength={40} autoComplete="name" required /></div>
      <div className="field"><label htmlFor="email">이메일</label><input className="input" id="email" name="email" type="email" autoComplete="email" onChange={(event) => setIsAdminEmail(event.target.value.trim().toLowerCase() === "hiway@kakao.com")} required /></div>
      <div className="field"><label htmlFor="password">비밀번호</label><input className="input" id="password" name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /><span className="tiny muted">10자 이상, 128자 이하</span></div>
      {isAdminEmail ? <div className="field"><label htmlFor="adminBootstrapCode">관리자 초기등록 코드</label><input className="input" id="adminBootstrapCode" name="adminBootstrapCode" type="password" autoComplete="off" required /><span className="tiny muted">최초 관리자 계정 탈취를 막기 위한 배포 환경의 1회용 코드입니다.</span></div> : null}
      <div className="notice">이메일 확인 절차 없이 바로 신청됩니다. 일반 계정은 관리자 승인 후 MCP를 발급할 수 있습니다.</div>
      {error ? <div className="notice error">{error}</div> : null}
      <button className="button primary" disabled={busy}>{busy ? "신청 중…" : "가입 신청"}</button>
    </form>
  );
}
