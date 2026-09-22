import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These Node fixtures are CommonJS, not Next application modules.
    files: ['tests/**/*.test.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@next/next/no-assign-module-variable': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
