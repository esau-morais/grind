import { useRef, useCallback, type ReactNode, type MouseEvent } from "react";
import { cn } from "#/lib/utils";

export function GlowingCards({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const cards = ref.current.getElementsByClassName("glowing-card");
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i] as HTMLElement;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
      card.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    }
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn("glowing-cards grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {children}
    </div>
  );
}

export function GlowingCard({
  title,
  body,
  children,
  className,
}: {
  title: string;
  body: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glowing-card relative overflow-hidden rounded-xl", className)}>
      <div className="relative z-[2] flex h-full m-px flex-col rounded-[11px] bg-grind-surface p-6">
        {children && (
          <div aria-hidden="true" className="mb-5">
            {children}
          </div>
        )}
        <h3 className="mb-2 text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
