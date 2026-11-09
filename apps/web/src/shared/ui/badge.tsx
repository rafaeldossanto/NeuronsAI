import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        running: "border-accent bg-accent/15 text-foreground",
        success: "border-foreground/20 bg-card text-foreground",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
