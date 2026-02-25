import { createFileRoute } from "@tanstack/react-router";
import { RobotIcon } from "@phosphor-icons/react";

export const Route = createFileRoute("/app/companion/")({
  component: CompanionPage,
});

function CompanionPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
        <RobotIcon size={28} className="text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Companion</h1>
        <p className="mt-1 text-sm text-muted-foreground">Coming soon…</p>
      </div>
    </div>
  );
}
