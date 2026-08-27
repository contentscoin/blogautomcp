import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlogAutoMCP",
  description: "ChatGPT에서 제어하는 네이버 브랜드커넥트 로컬 자동화",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
