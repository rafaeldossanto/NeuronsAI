import { peersOf } from "@neurons/graph-schema";
import { describe, expect, it } from "vitest";
import { buildBriefing } from "./briefing.js";
import { buildTestGraph } from "./testing/test-graph.js";

const graph = buildTestGraph();
const briefingOf = (name: string) => {
  const agent = graph.nodes.find((node) => node.type === "agent" && node.name === name);
  if (agent?.type !== "agent") throw new Error(`no agent ${name}`);
  return buildBriefing(agent, peersOf(graph, name));
};

describe("buildBriefing", () => {
  it("states who the agent is, its role and its instructions", () => {
    const text = briefingOf("Beta");

    expect(text).toContain('Você é "Beta"');
    expect(text).toContain("Papel: Papel de Beta");
    expect(text).toContain("Instruções de Beta.");
  });

  it("lists, with their roles, who the agent may start talks with and who may find it", () => {
    const text = briefingOf("Beta");

    const [startsWith, foundBy] = text
      .split("Você pode iniciar conversa com:")[1]!
      .split("Podem iniciar conversa com você:");
    expect(startsWith).toContain("- Gama: Papel de Gama");
    expect(startsWith).not.toContain("Alfa");
    expect(foundBy).toContain("- Alfa: Papel de Alfa");
    expect(foundBy).toContain("- Gama: Papel de Gama");
  });

  it("says so when there is nobody", () => {
    const text = briefingOf("Delta");

    expect(text.match(/- \(ninguém\)/g)).toHaveLength(2);
  });

  it("explains the five communication tools and the reply rule", () => {
    const text = briefingOf("Alfa");

    for (const tool of ["send_message", "ask", "reply", "list_peers", "finish"]) {
      expect(text).toContain(`\`${tool}(`);
    }
    expect(text).toContain("sempre pode receber resposta sua");
  });

  it("is deterministic", () => {
    expect(briefingOf("Alfa")).toBe(briefingOf("Alfa"));
  });
});
