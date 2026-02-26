import { cpSync, existsSync, readFileSync, writeFileSync } from "fs";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "none",
  external: ["@libsql/client", "@opentui/core"],
  define: {
    "process.env.GRIND_GOOGLE_CLIENT_SECRET": JSON.stringify(
      process.env.GRIND_GOOGLE_CLIENT_SECRET ?? "",
    ),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

cpSync("../core/drizzle", "./dist/drizzle", { recursive: true });

// ── Embed web app ──────────────────────────────────────────────────────────
const webDistDir = "../../apps/web/dist";

if (existsSync(`${webDistDir}/server/server.js`)) {
  cpSync(`${webDistDir}/server`, "./dist/web/server", { recursive: true });
  cpSync(`${webDistDir}/client`, "./dist/web/client", { recursive: true });
} else {
  console.warn(
    "Warning: apps/web not built, web embed skipped. Run `bun run --cwd apps/web build` first.",
  );
}

const outPath = "./dist/index.js";
const existing = readFileSync(outPath, "utf8");
writeFileSync(outPath, `#!/usr/bin/env bun\n${existing}`);
