import { RequirePermission } from "../accounts/require-permission.js";
import { Controller, Inject } from "@nestjs/common";
import { z } from "zod";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import { AccountAuth, AccountsUnavailableError } from "../accounts/account-auth.service.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { RunnerTokens } from "./runner-tokens.service.js";
import { RunnerRegistry } from "./runner-registry.js";
import type { RunnerRecord } from "./runner-repository.js";
import { RunnerNotFoundError } from "./runners.errors.js";

const runnerName = z.string().trim().min(1).max(100);
const runnerView = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  connected: z.boolean(),
  activeAgents: z.number().int().nonnegative(),
});
const issuedRunner = z.object({ id: z.uuid(), name: z.string(), token: z.string() });

/**
 * Tokens can only be issued through an authenticated organization; local uses the existing CLI.
 * The routes under `personal` belong to whoever calls: a member's own computers, which run only
 * what that member starts. The others manage the organization's runners, which run everyone's.
 */
@RequirePermission("manage_credentials")
@Controller("runners")
export class RunnersController {
  constructor(
    @Inject(AccountAuth) private readonly auth: AccountAuth,
    @Inject(RunnerTokens) private readonly tokens: RunnerTokens,
    @Inject(RunnerRegistry) private readonly registry: RunnerRegistry,
  ) {}
  @Endpoint({
    method: "get",
    path: "",
    summary: "Lista os runners da organização (não os pessoais), sem tokens.",
    response: z.object({ items: z.array(runnerView) }),
    errors: [403, 503],
  })
  async list() {
    this.auth.require();
    return { items: (await this.tokens.list()).map((runner) => this.present(runner)) };
  }
  @Endpoint({
    method: "post",
    path: "",
    summary: "Emite um token de runner da organização, mostrado uma única vez.",
    body: z.object({ name: runnerName }),
    response: issuedRunner,
    status: 201,
    errors: [403, 409, 503],
  })
  async create(@ValidBody() body: { name: string }) {
    this.auth.require();
    return this.tokens.issue(body.name);
  }
  @Endpoint({
    method: "get",
    path: "personal",
    summary: "Lista os seus runners pessoais, sem tokens.",
    response: z.object({ items: z.array(runnerView) }),
    errors: [403, 503],
  })
  async listPersonal() {
    this.auth.require();
    const owner = this.caller();
    return { items: (await this.tokens.listPersonal(owner)).map((runner) => this.present(runner)) };
  }
  @RequirePermission("write")
  @Endpoint({
    method: "post",
    path: "personal",
    summary:
      "Emite o token de um runner pessoal, que roda só as execuções que você iniciar. Com o mesmo nome, troca o token do runner que já existe.",
    body: z.object({ name: runnerName }),
    response: issuedRunner,
    status: 201,
    errors: [403, 503],
  })
  async createPersonal(@ValidBody() body: { name: string }) {
    this.auth.require();
    const issued = await this.tokens.issuePersonal(this.caller(), body.name);
    // A token that was replaced must not keep a connection open.
    this.registry.disconnect(issued.id);
    return issued;
  }
  @RequirePermission("write")
  @Endpoint({
    method: "delete",
    path: "personal/:id",
    summary: "Revoga um runner pessoal seu. Só o dono revoga; para os outros ele não existe.",
    params: z.object({ id: z.uuid() }),
    status: 204,
    errors: [403, 404, 503],
  })
  async revokePersonal(@ValidParams() params: { id: string }) {
    this.auth.require();
    if (!(await this.tokens.revokePersonal(params.id, this.caller()))) {
      throw new RunnerNotFoundError();
    }
    this.registry.disconnect(params.id);
  }
  @Endpoint({
    method: "delete",
    path: ":name",
    summary: "Revoga um runner da organização.",
    params: z.object({ name: runnerName }),
    status: 204,
    errors: [403, 503],
  })
  async revoke(@ValidParams() params: { name: string }) {
    this.auth.require();
    await this.tokens.revoke(params.name);
  }

  /** The signed-in user; a request in a scope without one cannot manage personal runners. */
  private caller(): string {
    const { userId } = resourceScope.current();
    if (!userId) throw new AccountsUnavailableError();
    return userId;
  }

  private present(runner: RunnerRecord) {
    const link = runner.revokedAt ? undefined : this.registry.find(runner.id);
    return {
      id: runner.id,
      name: runner.name,
      createdAt: runner.createdAt.toISOString(),
      lastSeenAt: runner.lastSeenAt?.toISOString() ?? null,
      revokedAt: runner.revokedAt?.toISOString() ?? null,
      connected: link?.connected ?? false,
      activeAgents: link?.load ?? 0,
    };
  }
}
