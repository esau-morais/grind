import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

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
    GRINDXP_VERSION: JSON.stringify(pkg.version),
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

// Clean stale artifacts from previous builds before copying.
rmSync("./dist/web", { recursive: true, force: true });

if (!existsSync(`${webDistDir}/server/server.js`)) {
  console.log("Building web app…");
  const webBuild = Bun.spawnSync(["bun", "run", "build"], { cwd: "../../apps/web" });
  if (webBuild.exitCode !== 0) {
    console.error("Failed to build web app.");
    process.exit(1);
  }
}

// Rebundle the SSR handler to inline all deps (react, tanstack, etc.)
// so it works without a node_modules next to it.
const rebundle = await Bun.build({
  entrypoints: [`${webDistDir}/server/server.js`],
  outdir: "./dist/web/dist/server",
  target: "bun",
  naming: "[name].js",
});

if (!rebundle.success) {
  for (const log of rebundle.logs) console.error(log);
  process.exit(1);
}

cpSync(`${webDistDir}/client`, "./dist/web/dist/client", { recursive: true });
cpSync(`${webDistDir}/server/assets`, "./dist/web/dist/server/assets", { recursive: true });
cpSync("../../apps/web/server.ts", "./dist/web/server.ts");

const outPath = "./dist/index.js";
const existing = readFileSync(outPath, "utf8");
writeFileSync(outPath, `#!/usr/bin/env bun\n${existing}`);
