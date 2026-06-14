// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
// `base` stays "/" for local dev and the standard build. The GitHub Pages
// workflow sets VITE_BASE="/<repo>/" so assets resolve under the project path
// at https://<user>.github.io/<repo>/.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [svelte()],
});
