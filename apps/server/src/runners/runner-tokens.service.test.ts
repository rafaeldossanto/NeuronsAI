import { describe, expect, it } from "vitest";
import { bearerToken, hashRunnerToken, RUNNER_TOKEN_PREFIX } from "./runner-token.js";
import { RunnerTokens } from "./runner-tokens.service.js";
import { RunnerNameTakenError } from "./runners.errors.js";
import { InMemoryRunnerRepository } from "./testing/in-memory-runner-repository.js";

const newTokens = () => new RunnerTokens(new InMemoryRunnerRepository());

describe("RunnerTokens", () => {
  it("issues a different long random token every time, shown once", async () => {
    const tokens = newTokens();

    const first = await tokens.issue("notebook");
    const second = await tokens.issue("desktop");

    expect(first.token.startsWith(RUNNER_TOKEN_PREFIX)).toBe(true);
    expect(first.token.length).toBeGreaterThanOrEqual(40);
    expect(first.token).not.toBe(second.token);
    expect(first).toMatchObject({ name: "notebook", id: expect.any(String) as string });
  });

  it("recognizes the runner by its token", async () => {
    const tokens = newTokens();
    const issued = await tokens.issue("notebook");

    expect(await tokens.authenticate(issued.token)).toEqual({ id: issued.id, name: "notebook" });
    expect(await tokens.authenticate(`${issued.token}x`)).toBeUndefined();
    expect(await tokens.authenticate("nrn_qualquer-outro")).toBeUndefined();
  });

  it("keeps only the hash of the token", async () => {
    const repository = new InMemoryRunnerRepository();
    const created = repository.create.bind(repository);
    const stored: { name: string; tokenHash: string }[] = [];
    repository.create = (input) => {
      stored.push(input);
      return created(input);
    };

    const issued = await new RunnerTokens(repository).issue("notebook");

    expect(stored).toEqual([{ name: "notebook", tokenHash: hashRunnerToken(issued.token) }]);
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stops recognizing a revoked token, and says whether anything was revoked", async () => {
    const tokens = newTokens();
    const issued = await tokens.issue("notebook");
    expect(await tokens.isActive(issued.id)).toBe(true);

    expect(await tokens.revoke("notebook")).toBe(true);

    expect(await tokens.authenticate(issued.token)).toBeUndefined();
    expect(await tokens.isActive(issued.id)).toBe(false);
    expect(await tokens.revoke("notebook")).toBe(false);
    expect(await tokens.revoke("nao-existe")).toBe(false);
  });

  it("does not issue two tokens for the same runner name", async () => {
    const tokens = newTokens();
    await tokens.issue("notebook");

    await expect(tokens.issue("notebook")).rejects.toBeInstanceOf(RunnerNameTakenError);
  });

  it("records when a runner was last seen", async () => {
    const tokens = newTokens();
    const issued = await tokens.issue("notebook");

    await tokens.markSeen(issued.id);

    expect((await tokens.list())[0]?.lastSeenAt).toBeInstanceOf(Date);
  });
});

describe("bearerToken", () => {
  it("reads the token of an Authorization header", () => {
    expect(bearerToken("Bearer nrn_abc")).toBe("nrn_abc");
    expect(bearerToken("bearer   nrn_abc")).toBe("nrn_abc");
  });

  it("refuses anything else", () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken("Bearer")).toBeUndefined();
    expect(bearerToken("Bearer a b")).toBeUndefined();
  });
});
