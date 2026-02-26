import type { Plugin } from "@opencode-ai/plugin";

export const PostEditPlugin: Plugin = async ({ $ }) => {
  return {
    "tool.execute.after": async (input, _output) => {
      if (input.tool !== "write" && input.tool !== "edit") return;
      await $`bun run lint`.quiet().nothrow();
      await $`bun run format`.quiet().nothrow();
    },
  };
};
