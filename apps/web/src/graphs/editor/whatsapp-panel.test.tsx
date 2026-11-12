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

const whatsapp: TriggerNode = {
  id: "gatilho-wa",
  type: "trigger",
  position: { x: 0, y: 0 },
  target: "agente",
  kind: "whatsapp",
  phoneNumberId: "106540352242922",
  appSecretName: "whatsapp-app-secret",
};

const VERIFY_TOKEN = "vt_" + "Q".repeat(43); // what the server would have just generated
const HOOK = "/hooks/AAAAAAAAAAAAAAAAAAAAAA";

const idle = {
  triggerId: "gatilho-wa",
  enabled: false,
  hookPath: null,
  hooksPort: 3101,
  hasSecret: false,
  secretSetAt: null,
  lastRun: null,
  nextRunAt: null,
};
const withToken = {
  ...idle,
  hookPath: HOOK,
  hasSecret: true,
  secretSetAt: "2026-11-11T12:00:00.000Z",
};

const stateRoute = `GET /graphs/${graphId}/triggers/gatilho-wa`;
const secretRoute = `POST /graphs/${graphId}/triggers/gatilho-wa/secret`;

function show(routes: Parameters<typeof mockFetch>[0], accessTokenNames: string[] = []) {
  const { fetch } = mockFetch(routes);
  render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <ApiProvider api={createApi(fetch)}>
          <ExternalTriggerPanel
            graphId={graphId}
            node={whatsapp}
            accessTokenNames={accessTokenNames}
          />
        </ApiProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("painel do gatilho WhatsApp", () => {
  it("mostra a URL para colar na Meta, o verify token só uma vez e os nomes dos segredos", async () => {
    show(
      {
        [stateRoute]: { body: idle },
        [secretRoute]: { status: 201, body: { secret: VERIFY_TOKEN, state: withToken } },
      },
      ["token-meta"],
    );

    expect(await screen.findByText("A URL aparece depois de gerar o verify token.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Gerar verify token/ }));

    expect(await screen.findByLabelText("Verify token")).toHaveTextContent(VERIFY_TOKEN);
    expect(screen.getByLabelText("URL do webhook")).toHaveTextContent(
      `http://127.0.0.1:3101${HOOK}`,
    );
    const secrets = screen.getByLabelText("Segredos do WhatsApp");
    expect(secrets).toHaveTextContent("whatsapp-app-secret");
    expect(secrets).toHaveTextContent("token-meta");

    await userEvent.click(screen.getByRole("button", { name: "Já copiei" }));
    expect(document.body).not.toHaveTextContent(VERIFY_TOKEN);
    expect(screen.getByRole("button", { name: /Gerar outro verify token/ })).toBeVisible();
  });

  it("sem ferramenta de resposta ligada, explica como ter o access token", async () => {
    show({ [stateRoute]: { body: withToken } });
    expect(await screen.findByLabelText("Segredos do WhatsApp")).toHaveTextContent(
      /WhatsApp \(resposta\)/,
    );
  });

  it("avisa quando a porta dos gatilhos está desligada", async () => {
    show({ [stateRoute]: { body: { ...idle, hooksPort: null } } });
    expect(await screen.findByRole("note")).toHaveTextContent("NEURONS_HOOKS_PORT");
  });
});
