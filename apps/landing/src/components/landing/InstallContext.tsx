import { createContext, useContext, useState } from "react";

export type InstallTabId = "curl" | "pkg" | "windows";
export type InstallPkgId = "bun" | "npm" | "yarn" | "pnpm";

type InstallContextValue = {
  activeTab: InstallTabId;
  setActiveTab: (tab: InstallTabId) => void;
  activePkg: InstallPkgId;
  setActivePkg: (pkg: InstallPkgId) => void;
};

const InstallContext = createContext<InstallContextValue | null>(null);

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<InstallTabId>("curl");
  const [activePkg, setActivePkg] = useState<InstallPkgId>("bun");

  return (
    <InstallContext.Provider value={{ activeTab, setActiveTab, activePkg, setActivePkg }}>
      {children}
    </InstallContext.Provider>
  );
}

export function useInstall(): InstallContextValue {
  const ctx = useContext(InstallContext);
  if (!ctx) throw new Error("useInstall must be used within InstallProvider");
  return ctx;
}
