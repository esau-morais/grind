import { getUserById } from "@grindxp/core/vault";
import { createFileRoute } from "@tanstack/react-router";
import { getVaultContext } from "#/server/vault.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { db, userId } = getVaultContext();
          const user = await getUserById(db, userId);
          if (!user) {
            return Response.json(
              { initialized: true },
              {
                headers: { "Access-Control-Allow-Origin": "*" },
              },
            );
          }
          return Response.json(
            {
              initialized: true,
              user: {
                displayName: user.displayName,
                level: user.level,
                totalXp: user.totalXp,
              },
            },
            { headers: { "Access-Control-Allow-Origin": "*" } },
          );
        } catch {
          return Response.json(
            { initialized: false },
            {
              headers: { "Access-Control-Allow-Origin": "*" },
            },
          );
        }
      },
    },
  },
});
