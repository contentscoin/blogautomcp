import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="BlogAutoMCP 홈">
      <span className="brand-mark">B</span>
      <span>BlogAutoMCP</span>
    </Link>
  );
}
