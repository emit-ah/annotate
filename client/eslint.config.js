import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-console": ["error", { allow: ["warn"] }],
      "max-lines": [
        "error",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["*.mjs", "e2e/**"],
    languageOptions: {
      globals: { URL: "readonly", process: "readonly", console: "readonly" },
    },
  },
  {
    files: ["demo/**"],
    languageOptions: { globals: { window: "readonly", document: "readonly" } },
  },
  {
    files: ["test/**", "e2e/**"],
    rules: { "max-lines-per-function": "off", "no-console": "off" },
  },
);
