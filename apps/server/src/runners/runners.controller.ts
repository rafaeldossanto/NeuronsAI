import { Controller, Inject } from "@nestjs/common";
import { z } from "zod";
import { Endpoint, ValidBody, ValidParams } from "../api/endpoint.js";
import { AccountAuth } from "../accounts/account-auth.service.js";
import { RunnerTokens } from "./runner-tokens.service.js";

const runnerName = z.string().trim().min(1).max(100);
const runnerView = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

/** Tokens can only be issued through an authenticated organization; local uses the existing CLI. */
@Controller("runners")
export class RunnersController {
  constructor(
    @Inject(AccountAuth) private readonly auth: AccountAuth,
    @Inject(RunnerTokens) private readonly tokens: RunnerTokens,
  ) {}
  @Endpoint({
    method: "get",
    path: "",
    summary: "Lista os runners da organização, sem tokens.",
    response: z.object({ items: z.array(runnerView) }),
    errors: [403, 503],
  })
  async list() {
    this.auth.require();
    return {
      items: (await this.tokens.list()).map((runner) => ({
        ...runner,
        createdAt: runner.createdAt.toISOString(),
        lastSeenAt: runner.lastSeenAt?.toISOString() ?? null,
        revokedAt: runner.revokedAt?.toISOString() ?? null,
      })),
    };
  }
  @Endpoint({
    method: "post",
    path: "",
    summary: "Emite um token de runner, mostrado uma única vez.",
    body: z.object({ name: runnerName }),
    response: z.object({ id: z.uuid(), name: z.string(), token: z.string() }),
    status: 201,
    errors: [403, 409, 503],
  })
  async create(@ValidBody() body: { name: string }) {
    this.auth.require();
    return this.tokens.issue(body.name);
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
}
