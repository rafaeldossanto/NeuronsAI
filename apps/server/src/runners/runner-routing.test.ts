import { randomUUID } from "node:crypto";
import { createMemoryChannelPair, PROTOCOL_VERSION } from "@neurons/runner-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { resourceScope } from "../accounts/resource-scope.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import type { RemoteAgentRuntime } from "./remote-agent-runtime.js";
import { RunnerRegistry } from "./runner-registry.js";
import { RunnerTokens } from "./runner-tokens.service.js";
import { NoRunnerAvailableError, RunnerNotAllowedError } from "./runners.errors.js";
import { InMemoryRunnerRepository } from "./testing/in-memory-runner-repository.js";

const org = randomUUID();
const otherOrg = randomUUID();
const ana = randomUUID();
const bia = randomUUID();

const repository = new InMemoryRunnerRepository();
const registry = new RunnerRegistry(
  testConfig({ runners: { graceMs: 1000, heartbeatMs: 1000, waitMs: 100 } }),
  repository,
);
afterEach(() => registry.onApplicationShutdown());

interface Connection {
  organizationId?: string;
  ownerUserId?: string;
  id?: string;
}

/** A runner that connects and sends its `register`, the way a real one does. */
function connect({ organizationId, ownerUserId, id = randomUUID() }: Connection = {}) {
  const pair = createMemoryChannelPair();
  registry.accept(
    {
      id,
      name: ownerUserId ? "pessoal" : "organização",
      ...(organizationId && { organizationId }),
      ...(ownerUserId && { ownerUserId }),
    },
    pair.server,
  );
  pair.runner.send({
    v: PROTOCOL_VERSION,
    type: "register",
    runner: { name: "runner", platform: "linux" },
    capabilities: { terminal: true, streamJson: true },
    agents: [],
  });
  return id;
}

/** Makes the runner look busy: each bound agent counts as one of its load. */
function occupy(runnerId: string, agents: number): void {
  for (let index = 0; index < agents; index += 1) {
    registry.find(runnerId)?.bind({ instanceId: randomUUID() } as RemoteAgentRuntime);
  }
}

/** A run of `org` started by `starter` (nobody when it comes from a trigger). */
const acquire = (starter?: string, runnerId?: string, organizationId: string | null = org) =>
  resourceScope.run({ organizationId, ...(starter && { userId: starter }) }, () =>
    registry.acquire(runnerId),
  );

describe("roteamento de runners pessoais e da organização", () => {
  it("manda a execução para o runner pessoal de quem a iniciou, mesmo com o da organização livre", async () => {
    const organization = connect({ organizationId: org });
    const mine = connect({ organizationId: org, ownerUserId: ana });
    occupy(mine, 3);

    expect(await acquire(ana)).toBe(registry.find(mine));
    expect(registry.find(organization)?.load).toBe(0);
  });

  it("entre os runners pessoais de quem iniciou, usa o menos ocupado", async () => {
    const busy = connect({ organizationId: org, ownerUserId: ana });
    const idle = connect({ organizationId: org, ownerUserId: ana });
    occupy(busy, 2);

    expect(await acquire(ana)).toBe(registry.find(idle));
  });

  it("usa o runner da organização, o menos ocupado, quando nenhum pessoal de quem iniciou está conectado", async () => {
    const busy = connect({ organizationId: org });
    const idle = connect({ organizationId: org });
    connect({ organizationId: org, ownerUserId: bia });
    occupy(busy, 2);

    expect(await acquire(ana)).toBe(registry.find(idle));
  });

  it("a execução de um colega nunca cai no meu runner pessoal", async () => {
    const mine = connect({ organizationId: org, ownerUserId: ana });
    const organization = connect({ organizationId: org });
    occupy(organization, 5);

    // Even though mine is idle and the organization's is busy.
    expect(await acquire(bia)).toBe(registry.find(organization));
    expect(registry.find(mine)?.load).toBe(0);
  });

  it("a execução de um colega espera e falha quando só há runners pessoais de outras pessoas", async () => {
    connect({ organizationId: org, ownerUserId: ana });

    await expect(acquire(bia)).rejects.toBeInstanceOf(NoRunnerAvailableError);
  });

  it("gatilhos (sem quem iniciou) usam só runners da organização", async () => {
    connect({ organizationId: org, ownerUserId: ana });
    expect(await acquire(undefined).catch((error: unknown) => error)).toBeInstanceOf(
      NoRunnerAvailableError,
    );

    const organization = connect({ organizationId: org });
    expect(await acquire(undefined)).toBe(registry.find(organization));
  });

  it("espera pelo primeiro runner que couber, pessoal ou da organização", async () => {
    const waitingForOrganization = acquire(ana);
    connect({ organizationId: org, ownerUserId: bia }); // someone else's: ignored
    const organization = connect({ organizationId: org });
    expect(await waitingForOrganization).toBe(registry.find(organization));

    registry.onApplicationShutdown();
    const waitingForPersonal = acquire(ana);
    const mine = connect({ organizationId: org, ownerUserId: ana });
    expect(await waitingForPersonal).toBe(registry.find(mine));
  });

  it("não usa o runner pessoal da mesma pessoa em outra organização", async () => {
    connect({ organizationId: otherOrg, ownerUserId: ana });

    await expect(acquire(ana)).rejects.toBeInstanceOf(NoRunnerAvailableError);
  });

  it("o runner embutido do perfil local (sem organização nem dono) continua servindo", async () => {
    const embedded = connect({ id: "embedded" });

    expect(await acquire(undefined, undefined, null)).toBe(registry.find(embedded));
    expect(await acquire(undefined, "embedded", null)).toBe(registry.find(embedded));
  });

  describe("com runner escolhido no agente", () => {
    it("aceita um runner da organização", async () => {
      const organization = connect({ organizationId: org });
      connect({ organizationId: org, ownerUserId: ana });

      expect(await acquire(ana, organization)).toBe(registry.find(organization));
      expect(await acquire(undefined, organization)).toBe(registry.find(organization));
    });

    it("aceita o runner pessoal de quem iniciou", async () => {
      const mine = connect({ organizationId: org, ownerUserId: ana });

      expect(await acquire(ana, mine)).toBe(registry.find(mine));
    });

    it("recusa na hora o runner pessoal de outra pessoa, sem esperar", async () => {
      const slow = new RunnerRegistry(
        testConfig({ runners: { graceMs: 1000, heartbeatMs: 1000, waitMs: 60_000 } }),
        repository,
      );
      const pair = createMemoryChannelPair();
      const hers = randomUUID();
      slow.accept({ id: hers, name: "dela", organizationId: org, ownerUserId: ana }, pair.server);
      pair.runner.send({
        v: PROTOCOL_VERSION,
        type: "register",
        runner: { name: "runner", platform: "linux" },
        capabilities: { terminal: true, streamJson: true },
        agents: [],
      });

      const failure = await resourceScope
        .run({ organizationId: org, userId: bia }, () => slow.acquire(hers))
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RunnerNotAllowedError);
      expect((failure as Error).message).toContain("computador pessoal de outro membro");
      // A trigger has nobody who started it: the personal runner is refused too.
      await expect(
        resourceScope.run({ organizationId: org }, () => slow.acquire(hers)),
      ).rejects.toBeInstanceOf(RunnerNotAllowedError);
      slow.onApplicationShutdown();
    });

    it("recusa na hora o runner pessoal de outra pessoa que ainda não se conectou", async () => {
      const tokens = new RunnerTokens(repository);
      const hers = await resourceScope.run({ organizationId: org, userId: ana }, () =>
        tokens.issuePersonal(ana, "notebook da ana"),
      );

      await expect(acquire(bia, hers.id)).rejects.toBeInstanceOf(RunnerNotAllowedError);
      // The owner's own request for it just waits for it to connect.
      await expect(acquire(ana, hers.id)).rejects.toBeInstanceOf(NoRunnerAvailableError);
    });

    it("um id que o banco não conhece só espera, sem erro de banco", async () => {
      await expect(acquire(ana, "embedded")).rejects.toBeInstanceOf(NoRunnerAvailableError);
      await expect(acquire(ana, randomUUID())).rejects.toBeInstanceOf(NoRunnerAvailableError);
    });
  });
});

describe("tokens de runners pessoais", () => {
  const tokens = new RunnerTokens(new InMemoryRunnerRepository());
  const as = <T>(userId: string, action: () => Promise<T>) =>
    resourceScope.run({ organizationId: org, userId }, action);

  it("o runner autenticado carrega o dono; o da organização não tem dono", async () => {
    const personal = await as(ana, () => tokens.issuePersonal(ana, "meu pc"));
    const shared = await as(ana, () => tokens.issue("do time"));

    expect(await tokens.authenticate(personal.token)).toEqual({
      id: personal.id,
      name: "meu pc",
      organizationId: org,
      ownerUserId: ana,
    });
    expect(await tokens.authenticate(shared.token)).toEqual({
      id: shared.id,
      name: "do time",
      organizationId: org,
    });
  });

  it("repetir o nome troca o token no mesmo registro, mesmo revogado", async () => {
    const first = await as(ana, () => tokens.issuePersonal(ana, "repetido"));
    await as(ana, () => tokens.revokePersonal(first.id, ana));
    expect(await tokens.authenticate(first.token)).toBeUndefined();

    const again = await as(ana, () => tokens.issuePersonal(ana, "repetido"));

    expect(again.id).toBe(first.id);
    expect(again.token).not.toBe(first.token);
    expect(await tokens.authenticate(first.token)).toBeUndefined();
    expect(await tokens.authenticate(again.token)).toMatchObject({ id: first.id });
    expect(await tokens.isActive(first.id)).toBe(true);
  });

  it("cada pessoa tem os seus nomes: dois membros podem ter o mesmo", async () => {
    const hers = await as(ana, () => tokens.issuePersonal(ana, "mesmo nome"));
    const his = await as(bia, () => tokens.issuePersonal(bia, "mesmo nome"));

    expect(hers.id).not.toBe(his.id);
  });

  it("só o dono lista e revoga os seus; os da organização ficam fora da lista pessoal", async () => {
    const mine = await as(ana, () => tokens.issuePersonal(ana, "lista"));
    await as(ana, () => tokens.issue("da organização"));

    expect((await as(ana, () => tokens.listPersonal(ana))).map((runner) => runner.id)).toContain(
      mine.id,
    );
    expect(await as(bia, () => tokens.listPersonal(bia))).not.toContainEqual(
      expect.objectContaining({ id: mine.id }),
    );
    expect((await as(ana, () => tokens.list())).map((runner) => runner.name)).not.toContain(
      "lista",
    );

    expect(await as(bia, () => tokens.revokePersonal(mine.id, bia))).toBe(false);
    expect(await tokens.isActive(mine.id)).toBe(true);
    expect(await as(ana, () => tokens.revokePersonal(mine.id, ana))).toBe(true);
    expect(await tokens.isActive(mine.id)).toBe(false);
  });

  it("revogar pelo nome da organização não alcança um runner pessoal de mesmo nome", async () => {
    const mine = await as(ana, () => tokens.issuePersonal(ana, "igual"));

    expect(await as(ana, () => tokens.revoke("igual"))).toBe(false);
    expect(await tokens.isActive(mine.id)).toBe(true);
  });
});
