// Builds the client twice from the same sources (ADR-0001): `annotate.js`, one self-contained file for a plain
// `<script src>` tag that installs `window.annotate` and mounts the mode, and `annotate.mjs`, an ES module for
// bundlers. Neither has a dependency, and neither uses eval.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const { version } = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url), "utf8"),
);
const shared = {
  bundle: true,
  target: "es2022",
  legalComments: "none",
  define: { __ANNOTATE_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
};

await build({
  ...shared,
  entryPoints: ["src/auto.ts"],
  format: "iife",
  minify: true,
  outfile: "dist/annotate.js",
});
await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  format: "esm",
  outfile: "dist/annotate.mjs",
});
