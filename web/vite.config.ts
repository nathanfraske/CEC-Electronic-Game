// SPDX-License-Identifier: Apache-2.0
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The teaching refsheets are the single source of truth in the repo's docs/ —
// `../docs/ui/parts` relative to this web/ vite root. They are NOT part of the
// app source, so this plugin bridges them into the served/built app at /parts/*:
// dev requests are answered from disk; a build copies them into dist/parts/. We do
// NOT commit a copy into web/public/ (docs/ stays the one source).
const PARTS_DIR = resolve(__dirname, "../docs/ui/parts");
// Only a bare `<file>.html` is ever served — no slashes, no `..`, no traversal.
const SAFE_HTML = /^[\w.-]+\.html$/;

/**
 * Serve the five-tier / teardown refsheets (docs/ui/parts/*.html) at `${base}parts/*`:
 *  • in dev (`configureServer`) by reading the file from disk on each request, and
 *  • in the static build (`closeBundle`) by copying every refsheet into dist/parts/,
 * so the Codex's "open the full teardown" links work in `pnpm dev` and on Pages alike.
 */
function refsheetsPlugin(base: string): Plugin {
  // Normalise the base to a leading-and-trailing-slash prefix, then the `/parts/` segment.
  const prefix =
    "/" + `${base}/parts/`.replace(/^\/+/, "").replace(/\/+/g, "/");
  return {
    name: "cec-refsheets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split("?")[0]! : "";
        if (!url.startsWith(prefix)) return next();
        const file = decodeURIComponent(url.slice(prefix.length));
        if (!SAFE_HTML.test(file)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const full = join(PARTS_DIR, file);
        if (!existsSync(full)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        // Stream the file straight from disk (docs/ is the live source in dev).
        import("node:fs").then(({ createReadStream }) => {
          createReadStream(full).pipe(res);
        });
      });
    },
    closeBundle() {
      if (!existsSync(PARTS_DIR)) return;
      const outDir = resolve(__dirname, "dist/parts");
      mkdirSync(outDir, { recursive: true });
      for (const file of readdirSync(PARTS_DIR)) {
        if (!SAFE_HTML.test(file)) continue;
        copyFileSync(join(PARTS_DIR, file), join(outDir, file));
      }
    },
  };
}

// https://vite.dev/config/
// `base` stays "/" for local dev and the standard build. The GitHub Pages
// workflow sets VITE_BASE="/<repo>/" so assets resolve under the project path
// at https://<user>.github.io/<repo>/.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [svelte(), refsheetsPlugin(base)],
});
