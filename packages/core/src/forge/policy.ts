import type { ForgeActionRisk, ForgeActionType, TrustLevel } from "../schema";

export type ForgeCompanionIntent = "suggest" | "draft" | "enable";

export interface ForgePermissionDecision {
  allowed: boolean;
  risk: ForgeActionRisk;
  requiresApproval: boolean;
  reason: string;
}

export const FORGE_ACTION_RISK: Record<ForgeActionType, ForgeActionRisk> = {
  "queue-quest": "low",
  "send-notification": "low",
  "update-skill": "medium",
  "log-to-vault": "medium",
  "trigger-companion": "medium",
  "run-script": "high",
};

export function getForgeActionRisk(actionType: ForgeActionType): ForgeActionRisk {
  return FORGE_ACTION_RISK[actionType];
}

export function evaluateCompanionForgePermission(
  trustLevel: TrustLevel,
  actionType: ForgeActionType,
  intent: ForgeCompanionIntent,
): ForgePermissionDecision {
  const risk = getForgeActionRisk(actionType);

  if (intent === "suggest") {
    return {
      allowed: true,
      risk,
      requiresApproval: false,
      reason: "Suggestions are always allowed.",
    };
  }

  if (intent === "draft") {
    if (trustLevel < 2) {
      return {
        allowed: false,
        risk,
        requiresApproval: true,
        reason: "Drafting forge rules requires trust level 2+.",
      };
    }

    if (risk === "high") {
      return {
        allowed: false,
        risk,
        requiresApproval: true,
        reason: "High-risk actions cannot be drafted automatically.",
      };
    }

    return {
      allowed: true,
      risk,
      requiresApproval: true,
      reason: "Draft allowed; user approval required before enablement.",
    };
  }

  if (risk === "high") {
    return {
      allowed: false,
      risk,
      requiresApproval: true,
      reason: "High-risk actions are never auto-enabled.",
    };
  }

  if (trustLevel >= 4) {
    return {
      allowed: true,
      risk,
      requiresApproval: false,
      reason: "Sovereign level can auto-enable low and medium risk rules.",
    };
  }

  if (trustLevel >= 3 && risk === "low") {
    return {
      allowed: true,
      risk,
      requiresApproval: false,
      reason: "Agent level can auto-enable low-risk rules.",
    };
  }

  return {
    allowed: false,
    risk,
    requiresApproval: true,
    reason: "Current trust level is insufficient for auto-enable.",
  };
}
