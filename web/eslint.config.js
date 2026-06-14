// SPDX-License-Identifier: Apache-2.0
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default tseslint.config(
  // Generated and build outputs are never linted.
  { ignores: ["dist/", "src/wasm/"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Parse the TypeScript inside <script lang="ts"> blocks.
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
);
