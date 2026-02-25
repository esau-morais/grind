import type { Skill } from "../schema";
import { skillSchema } from "../schema";
import { skillLevelFromXp } from "../xp";

export interface SkillTreeNode {
  skill: Skill;
  children: SkillTreeNode[];
}

export function updateSkillXp(skill: Skill, deltaXp: number): Skill {
  const nextXp = Math.max(0, skill.xp + deltaXp);
  return skillSchema.parse({
    ...skill,
    xp: nextXp,
    level: skillLevelFromXp(nextXp),
    updatedAt: Date.now(),
  });
}

export function buildSkillTree(skills: Skill[]): SkillTreeNode[] {
  const nodeById = new Map<string, SkillTreeNode>();

  for (const skill of skills) {
    nodeById.set(skill.id, {
      skill,
      children: [],
    });
  }

  const roots: SkillTreeNode[] = [];

  for (const node of nodeById.values()) {
    if (node.skill.parentId) {
      const parent = nodeById.get(node.skill.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function collectSkillXp(skills: Skill[]): number {
  return skills.reduce((sum, skill) => sum + skill.xp, 0);
}
