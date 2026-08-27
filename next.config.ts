import type { NextConfig } from "next";
import path from "node:path";

const repositoryRoot = process.env.npm_package_json
  ? path.dirname(process.env.npm_package_json)
  : process.cwd();

const nextConfig: NextConfig = {
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
