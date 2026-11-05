import { Controller, HttpException, Inject, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Endpoint, ValidBody, ValidParams, ValidQuery } from "../api/endpoint.js";
import { RateLimiter } from "../triggers/rate-limiter.js";
import { AccountsService } from "./accounts.service.js";
import { AccountAuth } from "./account-auth.service.js";
import { LoginAttemptError } from "./login.errors.js";

const callbackQuery = z.object({
  state: z.string().max(100).optional(),
  code: z.string().max(4096).optional(),
  error: z.string().max(200).optional(),
});
export const sessionView = z.object({
  enabled: z.boolean(),
  authenticated: z.boolean(),
  userId: z.uuid().optional(),
  organizationId: z.uuid().optional(),
  role: z.enum(["owner", "admin", "member", "viewer"]).optional(),
  csrfToken: z.string().optional(),
});

@Controller("auth")
export class AuthController {
  private readonly limiter = new RateLimiter(10);
  constructor(
    @Inject(AccountAuth) private readonly auth: AccountAuth,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  @Endpoint({
    method: "get",
    path: "session",
    summary: "Estado do login, sem credenciais.",
    response: sessionView,
    errors: [403],
  })
  async session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "no-store");
    if (!this.auth.browser) return { enabled: false, authenticated: false };
    const scope = await this.auth.browser.authenticate(request);
    return {
      enabled: true,
      authenticated: true,
      userId: scope.userId,
      organizationId: scope.organizationId,
      role: scope.role,
      csrfToken: this.auth.browser.csrfToken(request),
    };
  }

  @Endpoint({
    method: "post",
    path: "google",
    summary: "Inicia login Google no navegador do sistema.",
    response: z.object({ authorizationUrl: z.url() }),
    errors: [403, 429, 503],
  })
  async begin(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { browser, login } = this.auth.require();
    browser.requireSameOrigin(request);
    if (!this.limiter.tryTake(request.ip)) {
      reply.header("Retry-After", "60");
      throw new HttpException("Aguarde um minuto antes de iniciar outro login.", 429);
    }
    const attempt = await login.begin();
    reply.header("Cache-Control", "no-store");
    reply.header("Set-Cookie", browser.loginCookie(attempt.binding, attempt.expiresAt));
    return { authorizationUrl: attempt.authorizationUrl };
  }

  @Endpoint({
    method: "get",
    path: "google/callback",
    summary: "Confirma o retorno Google e cria sessão protegida.",
    query: callbackQuery,
    status: 302,
    errors: [403, 503],
  })
  async complete(
    @ValidQuery() query: z.infer<typeof callbackQuery>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { browser, login } = this.auth.require();
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    reply.header("Set-Cookie", browser.clearLoginCookie());
    if (query.error || !query.code || !query.state) throw new LoginAttemptError();
    const credentials = await login.complete({
      code: query.code,
      state: query.state,
      binding: browser.loginBinding(request),
    });
    reply.header("Set-Cookie", [
      browser.clearLoginCookie(),
      ...browser.setCredentials(credentials),
    ]);
    return reply.redirect("/graphs", 302);
  }

  @Endpoint({
    method: "post",
    path: "refresh",
    summary: "Renova a sessão protegida por cookie e CSRF.",
    status: 204,
    errors: [403, 503],
  })
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "no-store");
    reply.header("Set-Cookie", await this.auth.require().browser.refresh(request));
  }

  @Endpoint({
    method: "post",
    path: "logout",
    summary: "Encerra a sessão e apaga os cookies.",
    status: 204,
    errors: [403, 503],
  })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "no-store");
    reply.header("Set-Cookie", await this.auth.require().browser.logout(request));
  }

  @Endpoint({
    method: "get",
    path: "organizations",
    summary: "Lista as organizações da sessão atual.",
    response: z.object({
      items: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          role: z.enum(["owner", "admin", "member", "viewer"]),
        }),
      ),
    }),
    errors: [403, 503],
  })
  async organizations(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", "no-store");
    const scope = await this.auth.require().browser.authenticate(request);
    return { items: await this.accounts.listOrganizations(scope.userId) };
  }

  @Endpoint({
    method: "post",
    path: "organizations",
    summary: "Cria uma organização com você como proprietário.",
    body: z.object({ name: z.string().trim().min(1).max(200) }),
    response: z.object({ id: z.uuid(), name: z.string() }),
    status: 201,
    errors: [403, 503],
  })
  async createOrganization(@ValidBody() body: { name: string }, @Req() request: FastifyRequest) {
    const { browser } = this.auth.require();
    browser.requireMutation(request);
    const actor = await browser.authenticate(request);
    return this.accounts.createOrganization(actor.userId, body.name);
  }

  @Endpoint({
    method: "post",
    path: "organization",
    summary: "Muda para uma organização da sua conta e substitui a sessão.",
    body: z.object({ organizationId: z.uuid() }),
    status: 204,
    errors: [403, 503],
  })
  async selectOrganization(
    @ValidBody() body: { organizationId: string },
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { browser } = this.auth.require();
    browser.requireMutation(request);
    const actor = await browser.authenticate(request);
    await this.accounts.requireAccess(actor.userId, body.organizationId);
    const credentials = await this.auth.sessions.issue(actor.userId, body.organizationId);
    await browser.logout(request);
    reply
      .header("Cache-Control", "no-store")
      .header("Set-Cookie", browser.setCredentials(credentials));
  }

  @Endpoint({
    method: "get",
    path: "organizations/:id/members",
    summary: "Lista membros de uma organização da sua conta.",
    params: z.object({ id: z.uuid() }),
    response: z.object({
      items: z.array(
        z.object({
          userId: z.uuid(),
          displayName: z.string(),
          role: z.enum(["owner", "admin", "member", "viewer"]),
        }),
      ),
    }),
    errors: [403, 503],
  })
  async members(@ValidParams() params: { id: string }, @Req() request: FastifyRequest) {
    const actor = await this.auth.require().browser.authenticate(request);
    return { items: await this.accounts.listMembers(actor.userId, params.id) };
  }

  @Endpoint({
    method: "put",
    path: "organizations/:id/members/:userId",
    summary: "Define o papel de uma conta existente ou remove seu vínculo.",
    params: z.object({ id: z.uuid(), userId: z.uuid() }),
    body: z.object({ role: z.enum(["owner", "admin", "member", "viewer"]).nullable() }),
    status: 204,
    errors: [403, 404, 409, 503],
  })
  async setMember(
    @ValidParams() params: { id: string; userId: string },
    @ValidBody() body: { role: "owner" | "admin" | "member" | "viewer" | null },
    @Req() request: FastifyRequest,
  ) {
    const { browser } = this.auth.require();
    browser.requireMutation(request);
    const actor = await browser.authenticate(request);
    await this.accounts.setMember(actor.userId, params.id, params.userId, body.role);
  }
}
