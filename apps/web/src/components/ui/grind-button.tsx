import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#/lib/utils";

const grindButton = cva(
  "grind-btn inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,box-shadow,color,transform,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "grind-btn-primary",
        ghost: "grind-btn-ghost",
        muted: [
          "bg-secondary text-secondary-foreground",
          "border border-transparent",
          "hover:bg-secondary/80",
          "active:bg-secondary/60",
        ],
      },
      size: {
        sm: "h-8 px-4 text-xs",
        md: "h-10 px-6 text-sm",
        lg: "h-12 px-8 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type GrindButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof grindButton> & { asChild?: boolean };

export function GrindButton({ className, variant, size, asChild, ...props }: GrindButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(grindButton({ variant, size, className }))} {...props} />;
}
