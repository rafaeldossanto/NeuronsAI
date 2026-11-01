import { graphDefinitionSchema, type GraphDefinition } from "../schemas/graph.js";
import { createRuleContext, type ValidationRule } from "./context.js";
import type { GraphIssue } from "./issue.js";
import { noDuplicateLinks } from "./rules/duplicate-links.js";
import { groupMembersExist } from "./rules/group-members.js";
import { linkEndpointsExist, linkEndpointTypesMatchKind } from "./rules/link-endpoints.js";
import { hasTrigger, triggerTargetsAreAgents } from "./rules/triggers.js";
import { uniqueAgentNames } from "./rules/unique-agent-names.js";
import { uniqueIds } from "./rules/unique-ids.js";
import { fromZodError } from "./zod-issues.js";

export type ValidationResult =
  { ok: true; graph: GraphDefinition } | { ok: false; issues: GraphIssue[] };

export const graphRules: readonly ValidationRule[] = [
  uniqueIds,
  uniqueAgentNames,
  hasTrigger,
  triggerTargetsAreAgents,
  linkEndpointsExist,
  linkEndpointTypesMatchKind,
  noDuplicateLinks,
  groupMembersExist,
];

/** Parses the input against the schema, then runs every semantic rule and gathers all issues. */
export function validateGraph(input: unknown): ValidationResult {
  const parsed = graphDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: fromZodError(parsed.error) };

  const context = createRuleContext(parsed.data);
  const issues = graphRules.flatMap((rule) => rule(context));
  return issues.length === 0 ? { ok: true, graph: parsed.data } : { ok: false, issues };
}
