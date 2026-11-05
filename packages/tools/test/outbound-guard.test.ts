import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGuardedFetch,
  createTools,
  DestinationBlockedError,
  InMemorySecretResolver,
  isBlockedAddress,
  type OutboundPolicy,
  type ResolvedAddress,
} from "../src/index.js";
import { errorCodeOf, testContext, toolNode } from "./support.js";

describe("isBlockedAddress", () => {
  it.each([
    ["loopback IPv4", "127.0.0.1"],
    ["loopback fora do 127.0.0.1", "127.8.9.10"],
    ["0.0.0.0", "0.0.0.0"],
    ["link-local e metadados da nuvem", "169.254.169.254"],
    ["RFC 1918 10/8", "10.1.2.3"],
    ["RFC 1918 172.16/12 (início)", "172.16.0.1"],
    ["RFC 1918 172.16/12 (fim)", "172.31.255.255"],
    ["RFC 1918 192.168/16", "192.168.0.10"],
    ["CGNAT 100.64/10", "100.100.100.100"],
    ["documentação", "203.0.113.5"],
    ["benchmarking", "198.19.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["loopback IPv6", "::1"],
    ["não especificado IPv6", "::"],
    ["link-local IPv6", "fe80::1"],
    ["link-local IPv6 com zona", "fe80::1%eth0"],
    ["ULA fc00::/7", "fc00::1"],
    ["ULA fd (metadados IPv6 da AWS)", "fd00:ec2::254"],
    ["multicast IPv6", "ff02::1"],
    ["IPv4 mapeado em IPv6 (loopback)", "::ffff:127.0.0.1"],
    ["IPv4 mapeado em IPv6 (forma hexadecimal)", "::ffff:7f00:1"],
    ["IPv4 mapeado em IPv6 (metadados)", "::ffff:169.254.169.254"],
    ["IPv4 mapeado em IPv6 (privado)", "::ffff:10.0.0.1"],
    ["IPv4 compatível (obsoleto)", "::127.0.0.1"],
    ["NAT64 com IPv4 interno", "64:ff9b::a9fe:a9fe"],
    ["6to4 com IPv4 interno", "2002:7f00:1::1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["documentação IPv6", "2001:db8::1"],
    ["texto que não é IP", "localhost"],
  ])("barra %s", (_nome, address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ["8.8.8.8"],
    ["93.184.216.34"],
    ["172.15.255.255"],
    ["172.32.0.1"],
    ["100.63.255.255"],
    ["2606:4700:4700::1111"],
    ["::ffff:8.8.8.8"],
    ["64:ff9b::808:808"],
    ["2002:808:808::1"],
  ])("libera o endereço público %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

interface Seen {
  url: string;
  headers: IncomingMessage["headers"];
}

let server: Server;
let port: number;
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    const [path = ""] = (req.url ?? "").split("?");
    if (path === "/to-internal") {
      return void res.writeHead(302, { Location: "http://internal.test/segredo" }).end();
    }
    if (path === "/to-metadata") {
      return void res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }).end();
    }
    if (path === "/to-other") {
      return void res.writeHead(302, { Location: `http://other.test:${port}/final` }).end();
    }
    if (path === "/loop") return void res.writeHead(302, { Location: "/loop" }).end();
    if (path === "/same") return void res.writeHead(302, { Location: "/final" }).end();
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function resolver(table: Record<string, string[]>, calls: string[] = []) {
  return (hostname: string): Promise<ResolvedAddress[]> => {
    calls.push(hostname);
    const addresses = table[hostname];
    if (!addresses) return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
    return Promise.resolve(
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  };
}

function policy(overrides: Partial<OutboundPolicy> = {}): OutboundPolicy {
  return { allowedPorts: [80, 443], allowHosts: [], ...overrides };
}

describe("createGuardedFetch", () => {
  it.each([
    ["loopback", "http://127.0.0.1/"],
    ["metadados da nuvem", "http://169.254.169.254/latest/meta-data/"],
    ["rede privada", "http://10.0.0.5/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv4 mapeado", "http://[::ffff:127.0.0.1]/"],
    ["IPv4 em decimal", "http://2130706433/"],
    ["IPv4 em hexadecimal", "http://0x7f000001/"],
    ["0.0.0.0", "http://0.0.0.0/"],
  ])("barra o literal de %s antes de conectar", async (_nome, url) => {
    const calls: string[] = [];
    const guarded = createGuardedFetch(policy({ resolve: resolver({}, calls) }));
    await expect(guarded(url)).rejects.toBeInstanceOf(DestinationBlockedError);
    expect(calls).toEqual([]);
  });

  it.each([["file:///etc/passwd"], ["ftp://exemplo.com/"], ["gopher://exemplo.com/"]])(
    "recusa o protocolo de %s",
    async (url) => {
      const guarded = createGuardedFetch(policy());
      await expect(guarded(url)).rejects.toBeInstanceOf(DestinationBlockedError);
    },
  );

  it("recusa portas fora da lista, sem nem resolver o nome", async () => {
    const calls: string[] = [];
    const guarded = createGuardedFetch(
      policy({ resolve: resolver({ "api.test": ["8.8.8.8"] }, calls) }),
    );
    await expect(guarded("http://api.test:6379/")).rejects.toBeInstanceOf(DestinationBlockedError);
    expect(calls).toEqual([]);
  });

  it.each([
    ["só loopback", ["127.0.0.1"]],
    ["só metadados", ["169.254.169.254"]],
    ["rede privada", ["192.168.1.9"]],
    ["IPv6 mapeado", ["::ffff:10.0.0.1"]],
    ["resposta mista (um endereço público e um interno)", ["8.8.8.8", "10.0.0.1"]],
  ])("barra um nome cujo DNS aponta para %s", async (_nome, answer) => {
    const guarded = createGuardedFetch(
      policy({ resolve: resolver({ "evil.test": answer }), allowedPorts: [port] }),
    );
    await expect(guarded(`http://evil.test:${port}/`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
    expect(seen.some((entry) => entry.url === "/")).toBe(false);
  });

  it("resolve o nome uma só vez e conecta no endereço que validou (sem rebinding)", async () => {
    // O primeiro DNS responde interno; um segundo (que um rebinding usaria) responderia público.
    // Há uma única resolução por conexão, então o veredito vale para a conexão inteira.
    const calls: string[] = [];
    let answers = [["127.0.0.1"], ["8.8.8.8"]];
    const resolve = (hostname: string) => {
      calls.push(hostname);
      const [next = ["8.8.8.8"]] = answers.splice(0, 1);
      return Promise.resolve(next.map((address) => ({ address, family: 4 })));
    };
    const guarded = createGuardedFetch(policy({ resolve, allowedPorts: [port] }));
    await expect(guarded(`http://rebind.test:${port}/`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
    expect(calls).toEqual(["rebind.test"]);
    answers = [];
  });

  it("conecta no IP já validado quando o nome está na lista de permissão", async () => {
    const calls: string[] = [];
    const guarded = createGuardedFetch(
      policy({
        resolve: resolver({ "interno.test": ["127.0.0.1"] }, calls),
        allowHosts: ["interno.test"],
      }),
    );
    const response = await guarded(`http://interno.test:${port}/ping`);
    expect(await response.text()).toBe("ok");
    expect(calls).toEqual(["interno.test"]);
  });

  it("a lista de permissão aceita curinga e IP literal", async () => {
    const wildcard = createGuardedFetch(
      policy({
        resolve: resolver({ "a.interno.test": ["127.0.0.1"] }),
        allowHosts: ["*.interno.test"],
      }),
    );
    expect(await (await wildcard(`http://a.interno.test:${port}/`)).text()).toBe("ok");
    const literal = createGuardedFetch(policy({ allowHosts: ["127.0.0.1"] }));
    expect(await (await literal(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
    // O curinga não vale para o domínio raiz nem para sufixos parecidos.
    const strict = createGuardedFetch(
      policy({
        resolve: resolver({ "interno.test": ["127.0.0.1"], "xinterno.test": ["127.0.0.1"] }),
        allowHosts: ["*.interno.test"],
        allowedPorts: [port],
      }),
    );
    await expect(strict(`http://interno.test:${port}/`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
    await expect(strict(`http://xinterno.test:${port}/`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
  });

  it("confere o destino de cada redirecionamento", async () => {
    const guarded = createGuardedFetch(
      policy({
        resolve: resolver({ "origem.test": ["127.0.0.1"], "internal.test": ["127.0.0.1"] }),
        allowHosts: ["origem.test"],
      }),
    );
    await expect(guarded(`http://origem.test:${port}/to-internal`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
    await expect(guarded(`http://origem.test:${port}/to-metadata`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
  });

  it("não segue redirecionamentos para sempre", async () => {
    const guarded = createGuardedFetch(
      policy({
        resolve: resolver({ "origem.test": ["127.0.0.1"] }),
        allowHosts: ["origem.test"],
        maxRedirects: 3,
      }),
    );
    await expect(guarded(`http://origem.test:${port}/loop`)).rejects.toBeInstanceOf(
      DestinationBlockedError,
    );
  });

  it("segue redirecionamento na mesma origem mantendo os cabeçalhos", async () => {
    seen.length = 0;
    const guarded = createGuardedFetch(
      policy({
        resolve: resolver({ "origem.test": ["127.0.0.1"] }),
        allowHosts: ["origem.test"],
      }),
    );
    const response = await guarded(`http://origem.test:${port}/same`, {
      headers: { "x-api-key": "valor" },
    });
    expect(await response.text()).toBe("ok");
    expect(seen.at(-1)?.url).toBe("/final");
    expect(seen.at(-1)?.headers["x-api-key"]).toBe("valor");
  });

  it("redirecionamento para outra origem vai sem cabeçalhos", async () => {
    seen.length = 0;
    const guarded = createGuardedFetch(
      policy({
        resolve: resolver({ "origem.test": ["127.0.0.1"], "other.test": ["127.0.0.1"] }),
        allowHosts: ["origem.test", "other.test"],
      }),
    );
    const response = await guarded(`http://origem.test:${port}/to-other`, {
      headers: { "x-api-key": "valor", authorization: "Bearer x" },
    });
    expect(await response.text()).toBe("ok");
    expect(seen.at(-1)?.url).toBe("/final");
    expect(seen.at(-1)?.headers["x-api-key"]).toBeUndefined();
    expect(seen.at(-1)?.headers.authorization).toBeUndefined();
  });

  it("recusa redirecionamento 307 com corpo para outra origem", async () => {
    const seven = createServer((_req, res) => {
      res.writeHead(307, { Location: "http://elsewhere.test/" }).end();
    });
    await new Promise<void>((resolve) => seven.listen(0, "127.0.0.1", resolve));
    const sevenPort = (seven.address() as AddressInfo).port;
    try {
      const guarded = createGuardedFetch(
        policy({
          resolve: resolver({ "origem.test": ["127.0.0.1"], "elsewhere.test": ["127.0.0.1"] }),
          allowHosts: ["origem.test", "elsewhere.test"],
        }),
      );
      await expect(
        guarded(`http://origem.test:${sevenPort}/`, { method: "POST", body: "{}" }),
      ).rejects.toBeInstanceOf(DestinationBlockedError);
    } finally {
      await new Promise<void>((resolve) => seven.close(() => resolve()));
    }
  });
});

describe("ferramenta http com política de saída", () => {
  const secrets = new InMemorySecretResolver({ TOKEN: "segredo-do-token" });

  function httpTool(url: string, network: OutboundPolicy | undefined, headers = {}) {
    return createTools(toolNode({ kind: "http", method: "GET", url, headers }, "Externa"), {
      secrets,
      ...(network && { network }),
    });
  }

  it("devolve DESTINATION_BLOCKED para o endereço de metadados da nuvem", async () => {
    const set = await httpTool("http://169.254.169.254/latest/meta-data/", policy());
    const [tool] = set.tools;
    const result = await tool!.execute({}, testContext({ secrets }));
    expect(errorCodeOf(result)).toBe("DESTINATION_BLOCKED");
  });

  it("não vaza o segredo na mensagem quando ele está na URL de um destino barrado", async () => {
    const set = await httpTool("http://10.0.0.7/{{secret:TOKEN}}", policy());
    const [tool] = set.tools;
    const result = await tool!.execute({}, testContext({ secrets }));
    expect(errorCodeOf(result)).toBe("DESTINATION_BLOCKED");
    expect(JSON.stringify(result)).not.toContain("segredo-do-token");
  });

  it("sem política (perfil local) continua alcançando o localhost", async () => {
    const set = await httpTool(`http://127.0.0.1:${port}/ping`, undefined);
    const [tool] = set.tools;
    const result = await tool!.execute({}, testContext({ secrets }));
    expect(result.ok).toBe(true);
  });

  it("com política, o localhost só passa se estiver na lista de permissão", async () => {
    const barrado = await httpTool(`http://127.0.0.1:${port}/ping`, policy());
    expect(errorCodeOf(await barrado.tools[0]!.execute({}, testContext({ secrets })))).toBe(
      "DESTINATION_BLOCKED",
    );
    const liberado = await httpTool(
      `http://127.0.0.1:${port}/ping`,
      policy({ allowHosts: ["127.0.0.1"] }),
    );
    expect((await liberado.tools[0]!.execute({}, testContext({ secrets }))).ok).toBe(true);
  });

  it("o MCP por HTTP também passa pela guarda e nem chega a tocar o loopback", async () => {
    const before = seen.length;
    await expect(
      createTools(
        toolNode({
          kind: "mcp",
          transport: "http",
          url: `http://127.0.0.1:${port}/mcp-probe`,
          allowedTools: ["qualquer"],
        }),
        { secrets, network: policy({ allowedPorts: [port] }) },
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    expect(seen.slice(before).some((entry) => entry.url === "/mcp-probe")).toBe(false);
  });
});
