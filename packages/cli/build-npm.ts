import { cpSync, readFileSync, writeFileSync } from "fs";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "none",
  external: ["@libsql/client"],
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

const outPath = "./dist/index.js";
const existing = readFileSync(outPath, "utf8");
writeFileSync(outPath, `#!/usr/bin/env bun\n${existing}`);
