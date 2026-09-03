// Minimal flat config: typescript-eslint + react-hooks.
// Errors must be 0 for CI; noisy rules the codebase does not yet satisfy are
// downgraded to warnings so `pnpm run lint` reports them without failing.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/*.tsbuildinfo",
      "**/generated/**",
      "attached_assets/**",
      "screenshots/**",
      "evaluations/**",
      "docs/**",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    rules: {
      // Legacy code relies on these; keep visible, do not fail the build.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-namespace": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-case-declarations": "warn",
      "no-constant-condition": "warn",
      "no-control-regex": "warn",
      "prefer-const": "warn",
      // New in eslint 10 recommended; pre-existing violations in api-server.
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "no-extra-boolean-cast": "warn",
      "no-undef": "off",
    },
  },
  {
    files: ["artifacts/digisignal/src/**/*.{ts,tsx}", "artifacts/mockup-sandbox/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
