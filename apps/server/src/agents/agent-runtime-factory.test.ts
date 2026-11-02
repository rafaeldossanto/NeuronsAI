import type { AgentCommunication, AgentRuntime } from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import { describe, expect, it } from "vitest";
import { buildTestGraph } from "../hub/testing/test-graph.js";
import { RoutingAgentRuntimeFactory, RuntimeUnavailableError } from "./agent-runtime-factory.js";
import { FakeAgentRuntimeFactory } from "./testing/fake-agent-runtime.js";

const communication = {} as AgentCommunication;

const agentWith = (runtime: AgentNode["runtime"]): AgentNode => {
  const base = buildTestGraph().nodes.find((node): node is AgentNode => node.type === "agent");
  if (!base) throw new Error("the test graph has no agent");
  return { ...base, runtime };
};

const terminal: AgentNode["runtime"] = {
  kind: "terminal",
  cli: "claude",
  mode: "pty",
  args: [],
  cwd: "/tmp",
};
const api: AgentNode["runtime"] = { kind: "api", provider: "anthropic", model: "x" };

describe("RoutingAgentRuntimeFactory", () => {
  it("hands the agent to the factory of its runtime kind", () => {
    const terminals = new FakeAgentRuntimeFactory();
    const factory = new RoutingAgentRuntimeFactory({ terminal: terminals });

    const runtime: AgentRuntime = factory.create(agentWith(terminal), communication);

    expect(terminals.created).toEqual([runtime]);
  });

  it("reports a kind that has no factory yet as unavailable, naming the agent", () => {
    const factory = new RoutingAgentRuntimeFactory({ terminal: new FakeAgentRuntimeFactory() });
    const agent = agentWith(api);

    expect(() => factory.create(agent, communication)).toThrow(RuntimeUnavailableError);
    expect(() => factory.create(agent, communication)).toThrow(new RegExp(agent.name));
  });

  it("lets the kind's factory refuse what it cannot run (e.g. another CLI)", () => {
    const factory = new RoutingAgentRuntimeFactory({
      terminal: {
        create: () => {
          throw new Error('A CLI "codex" ainda não é suportada.');
        },
      },
    });

    expect(() => factory.create(agentWith({ ...terminal, cli: "codex" }), communication)).toThrow(
      /codex/,
    );
  });
});
