import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Keep linting independent of typechecking: the maintenance workflow should
// produce reviewable fixes, not turn formatting into a deployment gate.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.pnpm/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      // Explicit unused bindings are reviewed separately; avoid large
      // unrelated deletion diffs from an automatic maintenance run.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "no-undef": "off",
    },
  },
);
