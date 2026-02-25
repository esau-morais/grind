import type { TrustLevelName } from "./schema";
import { xpForLevelThreshold } from "./xp";

export const TRUST_LEVEL_NAMES: Record<number, TrustLevelName> = {
  0: "watcher",
  1: "advisor",
  2: "scribe",
  3: "agent",
  4: "sovereign",
};

export const XP_FOR_LEVEL = xpForLevelThreshold;

export const DEFAULT_MAX_ACTIVE_QUESTS = 5;
