import { describe, expect, it } from "vitest";
import { describeConnection, redactConnectionSecrets } from "./database-config.js";

describe("describeConnection", () => {
  it("masks the password of a URL", () => {
    const description = describeConnection({
      connectionString: "postgres://neurons:s3cr3t@db.example.com:5432/neurons",
    });

    expect(description).toBe("postgres://neurons:***@db.example.com:5432/neurons");
  });

  it("masks the password of the individual parts", () => {
    const description = describeConnection({
      host: "db",
      port: 5432,
      user: "neurons",
      password: "s3cr3t",
      database: "neurons",
    });

    expect(description).toBe("postgres://neurons:***@db:5432/neurons");
  });

  it("does not echo a URL it cannot parse", () => {
    expect(describeConnection({ connectionString: "not a url:s3cr3t" })).not.toContain("s3cr3t");
  });
});

describe("redactConnectionSecrets", () => {
  it("masks the password wherever the driver echoed it", () => {
    const connection = { connectionString: "postgres://neurons:p%40ss@db:5432/neurons" };
    const message = 'password authentication failed ("p%40ss" / "p@ss")';

    const safe = redactConnectionSecrets(message, connection);

    expect(safe).not.toMatch(/p%40ss|p@ss/);
    expect(safe).toContain("***");
  });

  it("masks the password of the individual parts", () => {
    const connection = { host: "h", port: 1, user: "u", password: "s3cr3t", database: "d" };

    expect(redactConnectionSecrets("failed with s3cr3t", connection)).toBe("failed with ***");
  });

  it("leaves text alone when the connection has no password", () => {
    expect(redactConnectionSecrets("boom", { connectionString: "postgres://h/d" })).toBe("boom");
  });
});
