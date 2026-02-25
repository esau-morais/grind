import { type Proof, type ProofType, proofSchema } from "../schema";
import { PROOF_MULTIPLIERS } from "../xp";

const SIGNAL_PROOF_TYPE: Record<string, ProofType> = {
  git: "git-commit",
  file: "file-change",
  process: "process-check",
};

export function getProofMultiplier(type: ProofType): number {
  return PROOF_MULTIPLIERS[type];
}

export function computeProofXp(baseXp: number, type: ProofType): number {
  const multiplier = getProofMultiplier(type);
  return Math.round(baseXp * multiplier);
}

export function createProof(input: Omit<Proof, "id" | "createdAt">): Proof {
  return proofSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  });
}

export function validateProof(input: unknown): Proof {
  return proofSchema.parse(input);
}

export function proofTypeFromSignalSource(source: string | null | undefined): ProofType {
  if (!source) return "timestamp";
  return SIGNAL_PROOF_TYPE[source] ?? "timestamp";
}
