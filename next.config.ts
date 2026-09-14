import type { NextConfig } from "next";
import path from "node:path";

const repositoryRoot = process.env.npm_package_json
  ? path.dirname(process.env.npm_package_json)
  : process.cwd();

const nextConfig: NextConfig = {
  webpack: (config) => {
    if (process.env.BLOGAUTO_FRESH_BUILD === "1") config.cache = false;
    return config;
  },
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
