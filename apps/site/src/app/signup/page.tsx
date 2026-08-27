import Link from "next/link";
import { Brand } from "@/components/brand";
import { SignupForm } from "@/components/auth-form";

export default function SignupPage() {
  return <main className="auth-wrap"><section className="auth-card card"><Brand /><h1>간단하게 시작하세요.</h1><p>이메일 확인은 없습니다. 신청 후 관리자가 이용 권한을 승인합니다.</p><SignupForm /><div className="auth-footer">이미 계정이 있나요? <Link href="/login">로그인</Link></div></section></main>;
}
