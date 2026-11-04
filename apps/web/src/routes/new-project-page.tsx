import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/states";
import { useCreateGraph } from "@/lib/queries";

/** The landing opens this route in another tab; never seed it with the marketing demo. */
export function NewProjectPage() {
  const create = useCreateGraph();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void create
      .mutateAsync("Projeto sem nome")
      .then((graph) => navigate(`/graphs/${graph.id}`, { replace: true }))
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Não foi possível criar o projeto."),
      );
  }, [create, navigate, attempt]);
  return error ? (
    <div className="flex flex-col gap-4">
      <p role="alert">{error}</p>
      <Button
        onClick={() => {
          started.current = false;
          setError("");
          setAttempt((n) => n + 1);
        }}
      >
        Tentar novamente
      </Button>
    </div>
  ) : (
    <LoadingRows label="Criando seu projeto" />
  );
}
