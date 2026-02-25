import type { LibSQLDatabase } from "drizzle-orm/libsql";

import type * as relations from "./relations";
import type * as schema from "./schema";

export type VaultSchema = typeof schema & typeof relations;
export type VaultDb = LibSQLDatabase<VaultSchema>;
export type VaultTx = Parameters<Parameters<VaultDb["transaction"]>[0]>[0];
