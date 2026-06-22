import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config for the whole pnpm workspace (SDK + apps + examples).
 *
 * typescript-eslint's non-type-checked "recommended" rules keep lint fast and
 * config-free (no per-package tsconfig wiring) while still catching real
 * problems: unused vars, no-explicit-any, unsafe ! / floating promises smells
 * that don't need type info, etc. CI runs `pnpm lint` as a hard, failing gate.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_`, and the
      // `void x` discard pattern used to drop destructured fields.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
    },
  },
  {
    // Tests may use non-null assertions freely against live queues.
    files: ["**/test/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
