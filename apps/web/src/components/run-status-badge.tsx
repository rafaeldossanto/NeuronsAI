import { Badge } from "@/components/ui/badge";
import { runStatusLabel } from "@/lib/format";

const variants = {
  pending: "default",
  running: "running",
  succeeded: "success",
  failed: "destructive",
  cancelled: "default",
} as const;

export function RunStatusBadge({ status }: { status: keyof typeof variants }) {
  return (
    <Badge variant={variants[status]}>
      {status === "running" && (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-accent"
          style={{ animation: "pulse-amber 1.4s ease-in-out infinite" }}
        />
      )}
      {runStatusLabel[status]}
    </Badge>
  );
}
