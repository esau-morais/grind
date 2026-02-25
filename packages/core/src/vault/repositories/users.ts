import { eq } from "drizzle-orm";

import type { CreateUserProfileInput, UserProfile } from "../../schema";
import { createUserProfileInputSchema, userProfileSchema } from "../../schema";
import { levelFromXp } from "../../xp";
import { users } from "../schema";
import type { VaultDb } from "../types";

function rowToProfile(row: typeof users.$inferSelect): UserProfile {
  return userProfileSchema.parse({
    id: row.id,
    displayName: row.displayName,
    level: row.level,
    totalXp: row.totalXp,
    preferences: {
      timezone: row.timezone,
      locale: row.locale,
      notificationsEnabled: row.notificationsEnabled,
      companionEnabled: row.companionEnabled,
      preferredModel: row.preferredModel ?? undefined,
    },
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function createUser(db: VaultDb, input: CreateUserProfileInput): Promise<UserProfile> {
  const valid = createUserProfileInputSchema.parse(input);

  const [row] = await db
    .insert(users)
    .values({
      id: valid.id,
      displayName: valid.displayName,
      level: valid.level,
      totalXp: valid.totalXp,
      timezone: valid.preferences.timezone,
      locale: valid.preferences.locale,
      notificationsEnabled: valid.preferences.notificationsEnabled,
      companionEnabled: valid.preferences.companionEnabled,
      preferredModel: valid.preferences.preferredModel,
      metadata: valid.metadata,
    })
    .returning();

  if (!row) throw new Error("Failed to insert user");
  return rowToProfile(row);
}

export async function getUserById(db: VaultDb, userId: string): Promise<UserProfile | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) return null;
  return rowToProfile(row);
}

export async function addXpToUser(
  db: VaultDb,
  userId: string,
  xpEarned: number,
): Promise<UserProfile> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw new Error("User not found");

  const newTotalXp = row.totalXp + xpEarned;
  const newLevel = levelFromXp(newTotalXp);

  const [updated] = await db
    .update(users)
    .set({ totalXp: newTotalXp, level: newLevel })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error("Failed to update user XP");
  return rowToProfile(updated);
}
