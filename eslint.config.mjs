import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Node CommonJS test fixtures intentionally load modules through a VM.
    files: ["src/**/*.test.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
  {
    files: [
      "fix-editor.js",
      "fix-openai.js",
      "fix-topic-agent.js",
      "print-env.js",
      "update-content.js",
      "update-main.js",
      "update-topic-agent.js",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    "out/**",
    "build/**",
    "apps/sites/dist/**",
    "**/src/generated/**",
    "**/tsconfig.tsbuildinfo",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
