import { lazy, Suspense } from "react";
import { KeyRound } from "lucide-react";
import type { GraphTemplate, TemplateCategory } from "@neurons/graph-schema";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

// React Flow is heavy and only the preview needs it: keep it out of the project list's first load.
const GraphViewer = lazy(() =>
  import("@/graphs/editor/graph-viewer").then((m) => ({ default: m.GraphViewer })),
);

const categories: Record<TemplateCategory, string> = {
  sales: "Vendas",
  research: "Pesquisa",
  development: "Desenvolvimento",
};
const empty = {};
const ignoreSelection = () => undefined;

export function TemplateCard({
  template,
  disabled,
  onChoose,
}: {
  template: GraphTemplate;
  disabled: boolean;
  onChoose: (template: GraphTemplate) => void;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-6" role="article" aria-label={template.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {categories[template.category]}
        </span>
        {template.requiresApiKey && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-1 text-xs font-semibold">
            <KeyRound className="size-3" aria-hidden />
            Precisa de chave de API
          </span>
        )}
      </div>
      <div>
        <h2 className="text-xl font-semibold">{template.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
      </div>
      <div
        className="h-56 overflow-hidden rounded-lg border bg-background"
        role="group"
        aria-label={`Prévia de ${template.name}`}
      >
        <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
          <GraphViewer
            doc={template.graph}
            live={empty}
            pulses={empty}
            selectedId={null}
            onSelect={ignoreSelection}
          />
        </Suspense>
      </div>
      <p className="text-xs text-muted-foreground">
        {template.requiresWorkdir
          ? "Pasta de trabalho definida na criação."
          : "Configure a API e o webhook antes de executar."}{" "}
        Orçamentos e limites de mensagens já definidos.
      </p>
      <Button
        className="mt-auto"
        variant="outline"
        disabled={disabled}
        onClick={() => onChoose(template)}
        aria-label={`Usar modelo ${template.name}`}
      >
        Usar modelo
      </Button>
    </Card>
  );
}
