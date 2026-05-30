import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma 클라이언트/엔진은 번들하지 않고 런타임에 node_modules에서 require 한다.
  // (Turbopack이 @prisma/client를 해시 외부모듈로 잘못 묶어 패키징 앱에서 못 찾는 문제 해결)
  serverExternalPackages: ["@prisma/client", ".prisma/client", "prisma"],
};

export default nextConfig;
