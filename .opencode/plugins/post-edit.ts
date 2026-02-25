import type { Plugin } from "@opencode-ai/plugin";

export const PostEditPlugin: Plugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.status") return;
      if (event.properties.status.type !== "idle") return;
      await $`bun run lint`.quiet().nothrow();
      await $`bun run format`.quiet().nothrow();
    },
  };
};
