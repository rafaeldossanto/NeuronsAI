import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { graphId, graphSummary, renderApp, runDetail, runId } from "@/test/helpers";

const versionId = "5d2a9e84-7c1b-4f30-a6e5-1d8b3c9f2a47";
const otherVersionId = "7a1c3e55-2b90-4d1f-9c6e-0a4b8d2f6e18";
const otherGraphId = "9c4e2b17-6d3a-4f85-b0a1-3e7d9c5a2b64";

const item = {
  id: runId,
  graphId,
  graphName: "Revisão de código",
  graphVersion: 2,
  graphVersionId: versionId,
  status: "succeeded" as const,
  budgetUsd: null,
  startedAt: "2026-11-02T12:00:00.000Z",
  finishedAt: "2026-11-02T12:01:05.000Z",
  durationMs: 65_000,
  costUsd: 0.0123,
  turns: 3,
  unknownCostTurns: 0,
};

const page = (items: unknown[], total = items.length) => ({
  body: { items, total, limit: 20, offset: 0 },
});

/** A `GET /runs` route that records the query of each request and answers with `reply(query)`. */
function runsRoute(reply: (query: URLSearchParams) => ReturnType<typeof page>) {
  const queries: URLSearchParams[] = [];
  const route = (request: Request) => {
    const query = new URL(request.url).searchParams;
    queries.push(query);
    return reply(query);
  };
  return { queries, route };
}

const versions = {
  items: [
    { id: versionId, graphId, version: 2, createdAt: "2026-11-02T10:00:00.000Z" },
    { id: otherVersionId, graphId, version: 1, createdAt: "2026-11-01T10:00:00.000Z" },
  ],
};
const graphRoutes = {
  "GET /graphs": {
    body: {
      items: [graphSummary, { ...graphSummary, id: otherGraphId, name: "Pesquisa" }],
    },
  },
  [`GET /graphs/${graphId}/versions`]: { body: versions },
  [`GET /graphs/${otherGraphId}/versions`]: { body: { items: [] } },
};

const last = <T,>(items: T[]) => items[items.length - 1]!;

describe("execuções", () => {
  it("só as execuções terminadas têm o botão Replay, que abre /runs/:id?replay=1", async () => {
    const running = {
      ...item,
      id: "0b5c7f1e-3a42-4d6b-8e21-9c4d7a6b5e31",
      status: "running" as const,
    };
    const { route } = runsRoute(() => page([item, running]));
    renderApp("/runs", { ...graphRoutes, "GET /runs": route });
    const link = await screen.findByRole("link", {
      name: `Replay da execução ${runId.slice(0, 8)}`,
    });
    expect(link).toHaveAttribute("href", `/runs/${runId}?replay=1`);
    expect(screen.getAllByRole("link", { name: /^Replay da execução/ })).toHaveLength(1);
  });

  it("lista as execuções com grafo, versão, status, datas, duração e custo", async () => {
    const { route } = runsRoute(() => page([item]));
    renderApp("/runs", { ...graphRoutes, "GET /runs": route });

    expect(screen.getByRole("status", { name: "Carregando execuções" })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "Revisão de código" });
    expect(link).toHaveAttribute("href", `/runs/${runId}`);
    const row = link.closest("tr")!;
    expect(within(row).getByText("v2")).toBeInTheDocument();
    expect(within(row).getByText("Concluída")).toBeInTheDocument();
    expect(within(row).getByText("1 min 5 s")).toBeInTheDocument();
    expect(within(row).getByText("$0.0123")).toBeInTheDocument();
  });

  it("não mostra custo desconhecido como zero", async () => {
    const partial = {
      ...item,
      id: "a".repeat(8) + item.id.slice(8),
      costUsd: 0.5,
      turns: 3,
      unknownCostTurns: 2,
    };
    const unknown = {
      ...item,
      id: "b".repeat(8) + item.id.slice(8),
      costUsd: 0,
      turns: 1,
      unknownCostTurns: 1,
    };
    const none = {
      ...item,
      id: "c".repeat(8) + item.id.slice(8),
      costUsd: 0,
      turns: 0,
      unknownCostTurns: 0,
    };
    const { route } = runsRoute(() => page([partial, unknown, none]));
    renderApp("/runs", { ...graphRoutes, "GET /runs": route });

    expect(await screen.findByText(/≥\s*\$0\.50/)).toBeInTheDocument();
    expect(screen.getByText("+ 2 turnos sem custo")).toBeInTheDocument();
    expect(screen.getByText("Desconhecido")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("lê os filtros do endereço e os manda para a API", async () => {
    const { route, queries } = runsRoute(() => page([item]));
    renderApp(
      `/runs?status=failed&graphId=${graphId}&graphVersionId=${versionId}&minCostUsd=0.5&maxCostUsd=2&from=2026-11-01&to=2026-11-03&sort=costly&page=1`,
      { ...graphRoutes, "GET /runs": route },
    );

    await screen.findByRole("link", { name: "Revisão de código" });
    const query = queries[0]!;
    expect(query.get("status")).toBe("failed");
    expect(query.get("graphId")).toBe(graphId);
    expect(query.get("graphVersionId")).toBe(versionId);
    expect(query.get("minCostUsd")).toBe("0.5");
    expect(query.get("maxCostUsd")).toBe("2");
    expect(query.get("sort")).toBe("costUsd");
    expect(query.get("order")).toBe("desc");
    expect(new Date(query.get("from")!).getTime()).toBe(new Date("2026-11-01T00:00:00").getTime());
    expect(new Date(query.get("to")!).getTime()).toBe(
      new Date("2026-11-03T23:59:59.999").getTime(),
    );
    expect(query.get("offset")).toBe("0");

    expect(screen.getByLabelText("Status")).toHaveValue("failed");
    expect(screen.getByLabelText("Custo mínimo (US$)")).toHaveValue("0.5");
    expect(screen.getByLabelText("Início de")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Ordenar por")).toHaveValue("costly");
    await waitFor(() => expect(screen.getByLabelText("Projeto")).toHaveValue(graphId));
    await waitFor(() => expect(screen.getByLabelText("Versão")).toHaveValue(versionId));
  });

  it("ordena por duração, das mais demoradas às mais rápidas", async () => {
    const { route, queries } = runsRoute(() => page([item]));
    renderApp(`/runs?sort=shortest`, { ...graphRoutes, "GET /runs": route });

    await screen.findByRole("link", { name: "Revisão de código" });
    expect(queries[0]!.get("sort")).toBe("durationMs");
    expect(queries[0]!.get("order")).toBe("asc");
    expect(screen.getByLabelText("Ordenar por")).toHaveValue("shortest");
    expect(screen.getByRole("option", { name: "Mais demoradas" })).toBeInTheDocument();
  });

  it("ignora no endereço o que não vale", async () => {
    const { route, queries } = runsRoute(() => page([item]));
    renderApp(
      `/runs?status=voando&graphId=x&graphVersionId=${versionId}&minCostUsd=-1&maxCostUsd=abc&from=ontem&sort=nome&page=0`,
      { ...graphRoutes, "GET /runs": route },
    );

    await screen.findByRole("link", { name: "Revisão de código" });
    expect([...queries[0]!.keys()].sort()).toEqual(["limit", "offset", "order", "sort"]);
  });

  it("muda os filtros pela barra e a lista segue", async () => {
    const { route, queries } = runsRoute(() => page([item]));
    renderApp("/runs?page=2", { ...graphRoutes, "GET /runs": route });
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Revisão de código" });

    await user.selectOptions(screen.getByLabelText("Status"), "failed");
    await waitFor(() => expect(last(queries).get("status")).toBe("failed"));
    expect(last(queries).get("offset")).toBe("0"); // voltou à primeira página

    await user.selectOptions(screen.getByLabelText("Projeto"), "Revisão de código");
    await waitFor(() => expect(last(queries).get("graphId")).toBe(graphId));
    await waitFor(() => expect(screen.getByRole("option", { name: "v2" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Versão"), "v1");
    await waitFor(() => expect(last(queries).get("graphVersionId")).toBe(otherVersionId));

    // trocar o projeto solta a versão
    await user.selectOptions(screen.getByLabelText("Projeto"), "Pesquisa");
    await waitFor(() => expect(last(queries).get("graphId")).toBe(otherGraphId));
    expect(last(queries).has("graphVersionId")).toBe(false);

    const min = screen.getByLabelText("Custo mínimo (US$)");
    await user.type(min, "1,5{Enter}");
    await waitFor(() => expect(last(queries).get("minCostUsd")).toBe("1.5"));
    const before = queries.length;
    await user.type(screen.getByLabelText("Custo máximo (US$)"), "3");
    expect(queries).toHaveLength(before); // só aplica no Enter ou ao sair do campo
    await user.tab();
    await waitFor(() => expect(last(queries).get("maxCostUsd")).toBe("3"));

    await user.type(screen.getByLabelText("Início de"), "2026-11-01");
    await waitFor(() => expect(last(queries).has("from")).toBe(true));

    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(last(queries).has("status")).toBe(false));
    expect(last(queries).has("graphId")).toBe(false);
    expect(last(queries).has("minCostUsd")).toBe(false);
    expect(last(queries).has("from")).toBe(false);
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();
  });

  it("pagina de 20 em 20", async () => {
    const { route, queries } = runsRoute(() => page([item], 45));
    renderApp("/runs", { ...graphRoutes, "GET /runs": route });
    const user = userEvent.setup();

    expect(await screen.findByText("45 execuções · página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("45 execuções · página 2 de 3")).toBeInTheDocument();
    expect(last(queries).get("offset")).toBe("20");
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("45 execuções · página 3 de 3")).toBeInTheDocument();
    expect(last(queries).get("offset")).toBe("40");
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(await screen.findByText("45 execuções · página 2 de 3")).toBeInTheDocument();
  });

  it("vai para a última página quando o endereço pede uma que não existe", async () => {
    const { route, queries } = runsRoute((query) =>
      query.get("offset") === "0" || query.get("offset") === "20"
        ? page([item], 25)
        : { body: { items: [], total: 25, limit: 20, offset: 100 } },
    );
    renderApp("/runs?page=6", { ...graphRoutes, "GET /runs": route });

    expect(await screen.findByText("25 execuções · página 2 de 2")).toBeInTheDocument();
    expect(last(queries).get("offset")).toBe("20");
  });

  it("avisa quando não há execuções", async () => {
    const { route } = runsRoute(() => page([]));
    renderApp("/runs", { ...graphRoutes, "GET /runs": route });
    expect(await screen.findByText("Nenhuma execução ainda")).toBeInTheDocument();
  });

  it("avisa quando os filtros não acham nada", async () => {
    const { route } = runsRoute(() => page([]));
    renderApp("/runs?status=failed", { ...graphRoutes, "GET /runs": route });
    expect(await screen.findByText("Nenhuma execução com esses filtros")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });

  it("clicar na linha abre a execução", async () => {
    const { route } = runsRoute(() => page([item]));
    const { calls } = renderApp("/runs", {
      ...graphRoutes,
      "GET /runs": route,
      [`GET /runs/${runId}`]: { body: runDetail },
      [`GET /runs/${runId}/events`]: { body: { items: [] } },
    });
    const user = userEvent.setup();

    const row = (await screen.findByText("1 min 5 s")).closest("tr")!;
    await user.click(row);
    await waitFor(() => expect(calls.map((c) => c.path)).toContain(`GET /runs/${runId}`));
    expect(screen.queryByRole("columnheader", { name: "Duração" })).not.toBeInTheDocument();
  });

  it("mostra erro de rede e tenta de novo", async () => {
    let attempts = 0;
    renderApp("/runs", {
      ...graphRoutes,
      "GET /runs": () => {
        attempts += 1;
        if (attempts === 1) return () => Promise.reject(new TypeError("fetch failed"));
        return page([item]);
      },
    });
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível falar com o servidor.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("link", { name: "Revisão de código" })).toBeInTheDocument();
  });
});
