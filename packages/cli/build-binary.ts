import { createRequire } from "module";

function getNativeTarget(): string {
  const target = process.env.TARGET;
  if (target) {
    const parts = target.replace(/^bun-/, "").split("-");
    const os = parts[0];
    const arch = parts[1];
    const libc = parts[2] ?? "gnu";
    if (os === "darwin") return `darwin-${arch}`;
    if (os === "windows") return "win32-x64-msvc";
    return `linux-${arch}-${libc}`;
  }
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "win32") return "win32-x64-msvc";
  return arch === "arm64" ? "linux-arm64-gnu" : "linux-x64-gnu";
}

const outfile = process.env.OUTFILE ?? "./dist/grind";
const target = process.env.TARGET as Bun.BuildConfig["target"] | undefined;

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  ...(target ? { target } : {}),
  compile: { outfile },
  define: {
    "process.env.GRIND_GOOGLE_CLIENT_SECRET": JSON.stringify(
      process.env.GRIND_GOOGLE_CLIENT_SECRET ?? "",
    ),
  },
  plugins: [
    {
      name: "patch-libsql-native",
      setup(build) {
        build.onLoad({ filter: /[/\\]libsql[/\\]index\.js$/ }, async (args) => {
          // Resolve from libsql's own directory so @libsql/<target> (libsql's optional dep) is reachable.
          const libsqlReq = createRequire(args.path);
          const nativePath = libsqlReq.resolve(`@libsql/${getNativeTarget()}`);
          let contents = await Bun.file(args.path).text();
          contents = contents.replaceAll(
            "require(`@libsql/${target}`)",
            `require(${JSON.stringify(nativePath)})`,
          );
          return { contents, loader: "js" };
        });
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
