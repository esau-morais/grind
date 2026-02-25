import { defineConfig } from "drizzle-kit";

const localVaultPath = process.env.GRIND_VAULT_PATH ?? "../../.grind/vault.db";
const localUrl = localVaultPath.startsWith("file:") ? localVaultPath : `file:${localVaultPath}`;

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

const config = tursoUrl
  ? defineConfig({
      out: "./drizzle",
      schema: "./src/vault/schema.ts",
      dialect: "turso",
      dbCredentials: {
        url: tursoUrl,
        authToken: tursoAuthToken ?? "",
      },
    })
  : defineConfig({
      out: "./drizzle",
      schema: "./src/vault/schema.ts",
      dialect: "sqlite",
      dbCredentials: {
        url: localUrl,
      },
    });

export default config;
