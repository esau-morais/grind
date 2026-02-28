/**
 * Production server for TanStack Start (Bun).
 *
 * Based on the official TanStack Start Bun reference server:
 * https://github.com/tanstack/router/blob/main/examples/react/start-bun/server.ts
 *
 * Key difference from the reference: CLIENT_DIRECTORY and SERVER_ENTRY_POINT
 * are anchored to import.meta.dir instead of process.cwd() so the server works
 * correctly regardless of what directory it is spawned from (e.g. when launched
 * by the grind CLI from the user's home directory).
 *
 * Environment variables:
 *   PORT                              – server port (default: 3000)
 *   ASSET_PRELOAD_MAX_SIZE            – max bytes to preload into memory (default: 5 MB)
 *   ASSET_PRELOAD_INCLUDE_PATTERNS    – comma-separated glob patterns to include
 *   ASSET_PRELOAD_EXCLUDE_PATTERNS    – comma-separated glob patterns to exclude
 *   ASSET_PRELOAD_VERBOSE_LOGGING     – "true" for detailed output
 *   ASSET_PRELOAD_ENABLE_ETAG         – "false" to disable ETags (default: true)
 *   ASSET_PRELOAD_ENABLE_GZIP         – "false" to disable gzip (default: true)
 *   ASSET_PRELOAD_GZIP_MIN_SIZE       – min bytes for gzip (default: 1024)
 *   ASSET_PRELOAD_GZIP_MIME_TYPES     – comma-separated MIME types for gzip
 */

import { join } from "node:path";

const SERVER_PORT = Number(process.env.PORT ?? 3000);

// Anchored to import.meta.dir so paths are correct regardless of CWD.
const CLIENT_DIRECTORY = join(import.meta.dir, "dist", "client");
const SERVER_ENTRY_POINT = join(import.meta.dir, "dist", "server", "server.js");

const MAX_PRELOAD_BYTES = Number(process.env.ASSET_PRELOAD_MAX_SIZE ?? 5 * 1024 * 1024);

const INCLUDE_PATTERNS = (process.env.ASSET_PRELOAD_INCLUDE_PATTERNS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(globToRegExp);

const EXCLUDE_PATTERNS = (process.env.ASSET_PRELOAD_EXCLUDE_PATTERNS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(globToRegExp);

const VERBOSE = process.env.ASSET_PRELOAD_VERBOSE_LOGGING === "true";
const ENABLE_ETAG = (process.env.ASSET_PRELOAD_ENABLE_ETAG ?? "true") === "true";
const ENABLE_GZIP = (process.env.ASSET_PRELOAD_ENABLE_GZIP ?? "true") === "true";
const GZIP_MIN_BYTES = Number(process.env.ASSET_PRELOAD_GZIP_MIN_SIZE ?? 1024);
const GZIP_TYPES = (
  process.env.ASSET_PRELOAD_GZIP_MIME_TYPES ??
  "text/,application/javascript,application/json,application/xml,image/svg+xml"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function computeEtag(data: Uint8Array): string {
  const hash = Bun.hash(data);
  return `W/"${hash.toString(16)}-${data.byteLength}"`;
}

interface InMemoryAsset {
  raw: Uint8Array;
  gz?: Uint8Array;
  etag?: string;
  type: string;
  immutable: boolean;
}

function isEligible(relativePath: string): boolean {
  const name = relativePath.split(/[/\\]/).pop() ?? relativePath;
  if (INCLUDE_PATTERNS.length > 0 && !INCLUDE_PATTERNS.some((r) => r.test(name))) return false;
  if (EXCLUDE_PATTERNS.some((r) => r.test(name))) return false;
  return true;
}

function isCompressible(mimeType: string): boolean {
  return GZIP_TYPES.some((t) => (t.endsWith("/") ? mimeType.startsWith(t) : mimeType === t));
}

function maybeGzip(data: Uint8Array, mimeType: string): Uint8Array | undefined {
  if (!ENABLE_GZIP) return undefined;
  if (data.byteLength < GZIP_MIN_BYTES) return undefined;
  if (!isCompressible(mimeType)) return undefined;
  try {
    return Bun.gzipSync(data.buffer as ArrayBuffer);
  } catch {
    return undefined;
  }
}

function makeHandler(asset: InMemoryAsset): (req: Request) => Response {
  return (req: Request) => {
    const headers: Record<string, string> = {
      "Content-Type": asset.type,
      "Cache-Control": asset.immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    };

    if (ENABLE_ETAG && asset.etag) {
      if (req.headers.get("if-none-match") === asset.etag) {
        return new Response(null, { status: 304, headers: { ETag: asset.etag } });
      }
      headers.ETag = asset.etag;
    }

    if (ENABLE_GZIP && asset.gz && req.headers.get("accept-encoding")?.includes("gzip")) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = String(asset.gz.byteLength);
      return new Response(new Uint8Array(asset.gz), { status: 200, headers });
    }

    headers["Content-Length"] = String(asset.raw.byteLength);
    return new Response(new Uint8Array(asset.raw), { status: 200, headers });
  };
}

async function loadStaticRoutes(
  clientDir: string,
): Promise<Record<string, (req: Request) => Response | Promise<Response>>> {
  const routes: Record<string, (req: Request) => Response | Promise<Response>> = {};

  const glob =
    INCLUDE_PATTERNS.length === 0
      ? new Bun.Glob("**/*")
      : INCLUDE_PATTERNS.length === 1
        ? new Bun.Glob(
            (process.env.ASSET_PRELOAD_INCLUDE_PATTERNS ?? "").split(",")[0]?.trim() ?? "**/*",
          )
        : new Bun.Glob(
            `{${(process.env.ASSET_PRELOAD_INCLUDE_PATTERNS ?? "")
              .split(",")
              .map((s) => s.trim())
              .join(",")}}`,
          );

  for await (const rel of glob.scan({ cwd: clientDir })) {
    const filepath = join(clientDir, rel);
    const route = `/${rel.split(/[/\\]/).join("/")}`;

    try {
      const file = Bun.file(filepath);
      if (!(await file.exists()) || file.size === 0) continue;

      const type = file.type || "application/octet-stream";

      if (isEligible(rel) && file.size <= MAX_PRELOAD_BYTES) {
        const raw = new Uint8Array(await file.arrayBuffer());
        const gz = maybeGzip(raw, type);
        const etag = ENABLE_ETAG ? computeEtag(raw) : undefined;
        const asset: InMemoryAsset = {
          raw,
          ...(gz !== undefined ? { gz } : {}),
          ...(etag !== undefined ? { etag } : {}),
          type,
          immutable: true,
        };
        routes[route] = makeHandler(asset);
        if (VERBOSE) console.log(`[PRELOAD] ${route} (${(raw.byteLength / 1024).toFixed(1)} kB)`);
      } else {
        routes[route] = () =>
          new Response(Bun.file(filepath), {
            headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" },
          });
        if (VERBOSE) console.log(`[ON-DEMAND] ${route}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("EISDIR")) continue;
      console.error(`[WARN] Failed to load ${filepath}:`, err);
    }
  }

  return routes;
}

async function main() {
  const { default: handler } = (await import(SERVER_ENTRY_POINT)) as {
    default: { fetch: (req: Request) => Response | Promise<Response> };
  };

  const staticRoutes = await loadStaticRoutes(CLIENT_DIRECTORY);

  const server = Bun.serve({
    port: SERVER_PORT,
    routes: {
      ...staticRoutes,
      "/*": (req: Request) => handler.fetch(req),
    },
    error(err) {
      console.error("[ERROR]", err.message);
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  console.log(`[INFO] Server running at http://localhost:${server.port}`);
}

main().catch((err: unknown) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
