import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "body-6 h-10 max-w-full rounded-md border border-input bg-card px-3 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
