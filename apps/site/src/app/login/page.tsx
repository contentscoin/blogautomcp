import Link from "next/link";
import { Suspense } from "react";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/auth-form";

export default function LoginPage() {
  return <main className="auth-wrap"><section className="auth-card card"><Brand /><h1>다시 만났네요.</h1><p>승인 상태와 로컬 에이전트를 확인하려면 로그인하세요.</p><Suspense fallback={<p className="muted">로그인 준비 중…</p>}><LoginForm /></Suspense><div className="auth-footer">처음이신가요? <Link href="/signup">가입 신청</Link></div></section></main>;
}
