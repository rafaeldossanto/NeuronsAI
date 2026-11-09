import { CircleCheck, TriangleAlert } from "lucide-react";
import { issueField, type LocatedIssue } from "./issues";
import type { GraphDoc } from "./model";

/** What the issue is about, in words ("Principal", "Conversa Principal → Executor"). */
function subject(issue: LocatedIssue, doc: GraphDoc): string | null {
  if (issue.targetNodeId) {
    const node = doc.nodes.find((n) => n.id === issue.targetNodeId);
    if (node?.type === "agent" || node?.type === "tool") return node.name || "Bloco sem nome";
    if (node?.type === "trigger") return "Gatilho";
  }
  if (issue.targetLinkId) {
    const link = doc.links.find((l) => l.id === issue.targetLinkId);
    const name = (id: string) => {
      const node = doc.nodes.find((n) => n.id === id);
      return node && "name" in node ? node.name : "?";
    };
    if (link) return `Seta ${name(link.from)} → ${name(link.to)}`;
  }
  return null;
}

export function IssuesPanel({
  issues,
  doc,
  onSelect,
}: {
  issues: LocatedIssue[];
  doc: GraphDoc;
  onSelect: (issue: LocatedIssue) => void;
}) {
  if (issues.length === 0) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"
      >
        <CircleCheck aria-hidden className="size-4" /> Nenhum problema: o grafo está válido.
      </p>
    );
  }
  return (
    <section aria-label="Problemas do grafo" className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <TriangleAlert aria-hidden className="size-4 text-destructive" />
        {issues.length === 1 ? "1 problema" : `${issues.length} problemas`}
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {issues.map((issue, index) => {
          const where = subject(issue, doc);
          const field = issueField(issue);
          const text = (
            <>
              {where && <b>{where}</b>}
              {field && <span className="text-muted-foreground"> · {field}</span>}
              {(where || field) && ": "}
              {issue.message}
            </>
          );
          const clickable = issue.targetNodeId !== undefined || issue.targetLinkId !== undefined;
          return (
            <li key={`${issue.code}-${index}`} className="text-sm">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelect(issue)}
                  className="w-full rounded-md px-2 py-1 text-left hover:bg-muted"
                >
                  {text}
                </button>
              ) : (
                <span className="block px-2 py-1">{text}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
