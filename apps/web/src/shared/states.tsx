import type { ReactNode } from "react";
import { ApiError } from "@/shared/api";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";

export function LoadingRows({
  rows = 3,
  label = "Carregando…",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** What to do next, by kind of failure: the server's own message says what happened, this says how to go on. */
function nextStep(error: Error): { title: string; hint?: string } {
  if (error instanceof ApiError) {
    if (error.code === "network_error")
      return {
        title: "Sem conexão com o servidor",
        hint: "Confira se o NeuronsAI está aberto e se a rede está funcionando; depois tente de novo.",
      };
    if (error.status === 401)
      return { title: "Sessão expirada", hint: "Entre de novo para continuar." };
    if (error.status === 403)
      return {
        title: "Sem permissão",
        hint: "Seu papel nesta organização não permite isso. Peça a um administrador.",
      };
  }
  return { title: "Algo deu errado" };
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { title, hint } = nextStep(error);
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
      <p className="font-semibold text-destructive">{title}</p>
      <p className="mt-1 text-sm">{error.message}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-input p-8 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
