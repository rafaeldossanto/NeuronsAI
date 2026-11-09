import type { TriggerNode } from "@neurons/graph-schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/app";
import { ApiProvider, createApi } from "@/shared/api";
import { graphId, mockFetch } from "@/test/helpers";
import { ExternalTriggerPanel } from "./trigger-panels";

const base = { type: "trigger", position: { x: 0, y: 0 }, target: "agente" } as const;
const webhook: TriggerNode = { ...base, id: "gatilho-w", kind: "webhook" };
const schedule: TriggerNode = {
  ...base,
  id: "gatilho-a",
  kind: "schedule",
  cron: "0 9 * * 1",
  timezone: "UTC",
};

const SECRET = "whsec_" + "Z".repeat(43); // what the server would have just generated
const HOOK = "/hooks/AAAAAAAAAAAAAAAAAAAAAA";

const idleState = {
  triggerId: "gatilho-w",
  enabled: false,
  hookPath: null,
  hooksPort: 3101,
  hasSecret: false,
  secretSetAt: null,
  lastRun: null,
  nextRunAt: null,
};

const withSecret = {
  ...idleState,
  hookPath: HOOK,
  hasSecret: true,
  secretSetAt: "2026-11-04T12:00:00.000Z",
};

function show(node: TriggerNode, routes: Parameters<typeof mockFetch>[0]) {
  const { fetch, calls } = mockFetch(routes);
  render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <ApiProvider api={createApi(fetch)}>
          <ExternalTriggerPanel graphId={graphId} node={node} />
        </ApiProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return calls;
}

const stateRoute = (id: string) => `GET /graphs/${graphId}/triggers/${id}`;
const secretRoute = (id: string) => `POST /graphs/${graphId}/triggers/${id}/secret`;

afterEach(() => vi.restoreAllMocks());

describe("webhook", () => {
  it("before the secret: no URL yet, and a button to generate it", async () => {
    show(webhook, { [stateRoute("gatilho-w")]: { body: idleState } });

    expect(await screen.findByText("Desativado")).toBeInTheDocument();
    expect(screen.getByText("A URL aparece depois de gerar o segredo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gerar segredo/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Exemplo de curl")).not.toBeInTheDocument();
  });

  it("generating shows the secret once, with a warning, and then the URL and a signed curl", async () => {
    show(webhook, {
      [stateRoute("gatilho-w")]: { body: idleState },
      [secretRoute("gatilho-w")]: { status: 201, body: { secret: SECRET, state: withSecret } },
    });

    await userEvent.click(await screen.findByRole("button", { name: /Gerar segredo/ }));

    expect(await screen.findByLabelText("Segredo do webhook")).toHaveTextContent(SECRET);
    expect(screen.getByText(/não será mostrado de novo/)).toBeInTheDocument();
    expect(screen.getByLabelText("URL do webhook")).toHaveTextContent(
      `http://127.0.0.1:3101${HOOK}`,
    );
    const curl = screen.getByLabelText("Exemplo de curl");
    expect(curl).toHaveTextContent(`http://127.0.0.1:3101${HOOK}`);
    expect(curl).toHaveTextContent("NEURONS_WEBHOOK_SECRET");
    expect(curl).not.toHaveTextContent(SECRET);

    // Once the user says they copied it, it is gone for good; the panel only knows one exists.
    await userEvent.click(screen.getByRole("button", { name: "Já copiei" }));
    expect(screen.queryByLabelText("Segredo do webhook")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trocar segredo/ })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SECRET);
  });

  it("replacing an existing secret asks first", async () => {
    const calls = show(webhook, {
      [stateRoute("gatilho-w")]: { body: withSecret },
      [secretRoute("gatilho-w")]: { status: 201, body: { secret: SECRET, state: withSecret } },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await userEvent.click(await screen.findByRole("button", { name: /Trocar segredo/ }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: /Trocar segredo/ }));
    expect(await screen.findByLabelText("Segredo do webhook")).toBeInTheDocument();
  });

  it("warns that the hooks port is off", async () => {
    show(webhook, { [stateRoute("gatilho-w")]: { body: { ...idleState, hooksPort: null } } });
    expect(await screen.findByRole("note")).toHaveTextContent("NEURONS_HOOKS_PORT");
  });

  it("turning on shows the server's reason when it refuses", async () => {
    show(webhook, {
      [stateRoute("gatilho-w")]: { body: idleState },
      [`PUT /graphs/${graphId}/triggers/gatilho-w/enabled`]: {
        status: 409,
        body: {
          code: "webhook_secret_required",
          message: "Gere o segredo do webhook antes de ativá-lo.",
        },
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Ativar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Gere o segredo do webhook");
  });

  it("shows the last call, with its note", async () => {
    show(webhook, {
      [stateRoute("gatilho-w")]: {
        body: {
          ...withSecret,
          enabled: true,
          lastRun: {
            at: "2026-11-04T12:00:00.000Z",
            outcome: "failed",
            note: "O grafo ainda não tem versão publicada.",
            runId: null,
          },
        },
      },
    });

    expect(await screen.findByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText(/Não conseguiu iniciar a execução/)).toBeInTheDocument();
    expect(screen.getByText("O grafo ainda não tem versão publicada.")).toBeInTheDocument();
  });
});

describe("schedule", () => {
  it("shows the next run and the last one, with a link to its run, and has no secret", async () => {
    show(schedule, {
      [stateRoute("gatilho-a")]: {
        body: {
          ...idleState,
          triggerId: "gatilho-a",
          enabled: true,
          nextRunAt: "2026-11-09T09:00:00.000Z",
          lastRun: {
            at: "2026-11-02T09:00:00.000Z",
            outcome: "skipped_overlap",
            note: "A execução anterior (x) ainda está em andamento; este horário foi pulado.",
            runId: "0b5c7f1e-3a42-4d6b-8e21-9c4d7a6b5e30",
          },
        },
      },
    });

    expect(await screen.findByText("Próxima execução")).toBeInTheDocument();
    expect(screen.getByText(/Pulada: a execução anterior ainda rodava/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir a execução" })).toHaveAttribute(
      "href",
      "/runs/0b5c7f1e-3a42-4d6b-8e21-9c4d7a6b5e30",
    );
    expect(screen.queryByText("Segredo")).not.toBeInTheDocument();
  });
});
