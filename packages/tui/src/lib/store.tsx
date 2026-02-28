import type { Quest, Skill, UserProfile, VaultDb } from "@grindxp/core";
import { type TimerState, readTimer } from "@grindxp/core";
import { getUserById, listQuestsByUser, listSkillsByUser } from "@grindxp/core/vault";
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import type { TuiContext } from "./context";
import { useEffectEvent } from "./use-effect-event";

interface StoreValue {
  user: UserProfile;
  quests: Quest[];
  skills: Skill[];
  timer: TimerState | null;
  db: VaultDb;
  timerPath: string;
  refresh: () => Promise<void>;
}

const StoreCtx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
}

export function StoreProvider(props: { ctx: TuiContext; children: ReactNode }) {
  const { ctx } = props;
  const [user, setUser] = useState<UserProfile>(ctx.user);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const refreshingRef = useRef(false);

  const refresh = useEffectEvent(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const [freshUser, freshQuests, freshSkills] = await Promise.all([
        getUserById(ctx.db, ctx.config.userId),
        listQuestsByUser(ctx.db, ctx.config.userId),
        listSkillsByUser(ctx.db, ctx.config.userId),
      ]);
      if (freshUser) setUser(freshUser);
      setQuests(freshQuests);
      setSkills(freshSkills);
      setTimer(readTimer(ctx.timerPath));
    } finally {
      refreshingRef.current = false;
    }
  });

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <StoreCtx.Provider
      value={{ user, quests, skills, timer, db: ctx.db, timerPath: ctx.timerPath, refresh }}
    >
      {props.children}
    </StoreCtx.Provider>
  );
}
