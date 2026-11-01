export interface GraphIssue {
  /** Stable machine-readable code (English). */
  code: string;
  /** Message shown to the user (pt-BR). */
  message: string;
  path?: (string | number)[];
  nodeId?: string;
  linkId?: string;
}

export type GraphIssueLocation = Pick<GraphIssue, "path" | "nodeId" | "linkId">;

export function createIssue(
  code: string,
  message: string,
  location: GraphIssueLocation = {},
): GraphIssue {
  return { code, message, ...location };
}
