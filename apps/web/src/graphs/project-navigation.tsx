import { Link } from "react-router";
import { cn } from "@/shared/utils";

function projectPath(graphId: string, params: URLSearchParams) {
  const search = params.toString();
  return `/graphs/${encodeURIComponent(graphId)}${search ? `?${search}` : ""}`;
}

export function chatPath(graphId: string, agentId?: string) {
  const params = new URLSearchParams({ view: "chats" });
  if (agentId) params.set("agent", agentId);
  return projectPath(graphId, params);
}

export function flowPath(graphId: string, nodeId?: string) {
  const params = new URLSearchParams();
  if (nodeId) params.set("node", nodeId);
  return projectPath(graphId, params);
}

export function ProjectNavigation({
  graphId,
  chats,
  agentId,
}: {
  graphId: string;
  chats: boolean;
  agentId?: string | undefined;
}) {
  const links = [
    { label: "Fluxo", href: flowPath(graphId, agentId), active: !chats },
    { label: "Chats", href: chatPath(graphId, agentId), active: chats },
  ];
  return (
    <nav aria-label="Projeto" className="flex shrink-0 gap-4">
      {links.map(({ label, href, active }) => (
        <Link
          key={label}
          to={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "border-b-2 px-2 py-2 text-sm font-medium",
            active
              ? "border-accent font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
