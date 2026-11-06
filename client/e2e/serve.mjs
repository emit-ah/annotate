// Serves the demo pages and the built client for the end-to-end tests, under the strict CSP that annotate promises to
// work with (ADR-0001): no inline script or style, no eval, the app's own host only. The API is mocked by the tests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
};
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The file for the address `pathname`: the client under /dist/, the demo pages elsewhere. */
function fileOf(pathname) {
  const path = normalize(pathname === "/" ? "/index.html" : pathname);
  return path.startsWith("/dist/")
    ? join(ROOT, path)
    : join(ROOT, "demo", path);
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  try {
    const body = await readFile(fileOf(pathname));
    response.writeHead(200, {
      "Content-Type":
        TYPES[extname(pathname === "/" ? "/index.html" : pathname)] ??
        "application/octet-stream",
      "Content-Security-Policy": CSP,
    });
    response.end(body);
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain",
      "Content-Security-Policy": CSP,
    });
    response.end("not found");
  }
}).listen(PORT, "127.0.0.1");
