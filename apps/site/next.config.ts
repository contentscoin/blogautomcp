import type { NextConfig } from "next";
import path from "node:path";

const siteDirectory = process.env.npm_package_json
  ? path.dirname(process.env.npm_package_json)
  : process.cwd();
const repositoryRoot = path.resolve(siteDirectory, "../..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
