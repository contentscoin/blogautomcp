import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { RemoteAgentPoller } from "@/components/RemoteAgentPoller";
import { ActivationGate } from "@/components/ActivationGate";
import { AdminSessionGate } from "@/components/AdminSessionGate";
import { MaterialJobProgress } from "@/components/MaterialJobProgress";

export const metadata: Metadata = {
  title: "네이버 블로그 자동화 | V6",
  description: "브랜드커넥트 링크 관리 및 블로그 자동 발행 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AdminSessionGate>
            <ActivationGate>
              <RemoteAgentPoller />
              <MaterialJobProgress />
              {children}
            </ActivationGate>
          </AdminSessionGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
