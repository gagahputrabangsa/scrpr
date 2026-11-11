import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow",
        secondary:
          "border-border bg-secondary/80 text-secondary-foreground hover:bg-secondary",
        destructive:
          "border-red-500/30 bg-red-500/10 text-red-400",
        outline: "border-border text-foreground",
        emerald:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        amber:
          "border-amber-500/30 bg-amber-500/10 text-amber-300",
        blue:
          "border-sky-500/30 bg-sky-500/10 text-sky-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

