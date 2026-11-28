import type { OrganizationRole } from "../database/schema/accounts.js";
import type {
  GraphAccessMode,
  GraphAccessStatus,
  GraphGrantLevel,
} from "../database/schema/index.js";

/**
 * What a person can do with one project, from most to least:
 * - `manage`: everything, and decides who else gets in (owners/admins of the organization and the
 *   project's owner);
 * - `edit`: edits the draft, publishes, configures triggers and sees every run;
 * - `use`: runs the published version and sees only the runs they started, never the draft;
 * - `view`: reads like a viewer of the organization always could (draft, versions), no running; sees
 *   every run in a project open to the organization, but only their own in a restricted one;
 * - `none`: the project shows on the list with its name and nothing else.
 */
export type GraphAccessLevel = "manage" | "edit" | "use" | "view" | "none";

/** The part of a project the decision is about. */
export interface GraphAccessFacts {
  ownerUserId?: string | null;
  accessMode?: GraphAccessMode;
}

/** What the owner decided about one person (a row of `graph_access`). */
export interface GraphAccessEntryFacts {
  status: GraphAccessStatus;
  level: GraphGrantLevel | null;
}

export interface GraphAccessSubject {
  userId: string;
  role: OrganizationRole;
}

/**
 * The single place where "who may do what in a project" is decided (the database only supplies the
 * facts). The role in the organization is the ceiling: a viewer never runs, whatever was granted.
 */
export function resolveGraphAccess(
  graph: GraphAccessFacts,
  subject: GraphAccessSubject,
  entry: GraphAccessEntryFacts | undefined,
): GraphAccessLevel {
  const { role, userId } = subject;
  // The people who run the organization and the project's owner are never locked out (nor blockable).
  if (role === "owner" || role === "admin") return "manage";
  if (graph.ownerUserId === userId) return role === "viewer" ? "view" : "manage";
  if (entry?.status === "blocked") return "none";
  if (graph.accessMode !== "restricted") return role === "member" ? "edit" : "view";
  if (entry?.status !== "granted") return "none";
  if (role === "viewer") return "view";
  return entry.level === "edit" ? "edit" : "use";
}

/** Without a signed-in person (the account-free workspace, or internal work) nothing is held back. */
export const UNRESTRICTED_ACCESS: GraphAccessLevel = "edit";

/** May open the project and read its published versions. */
export const canSeeGraph = (level: GraphAccessLevel): boolean => level !== "none";
/** May read the draft (read-only for who cannot edit). Runs follow {@link runReach}. */
export const canReadDraft = (level: GraphAccessLevel): boolean =>
  level === "view" || level === "edit" || level === "manage";
/** May start a run of a published version. */
export const canRunGraph = (level: GraphAccessLevel): boolean =>
  level === "use" || level === "edit" || level === "manage";
/** May change the draft, publish and configure triggers. */
export const canEditGraph = (level: GraphAccessLevel): boolean =>
  level === "edit" || level === "manage";
/** May decide who gets in. */
export const canManageGraph = (level: GraphAccessLevel): boolean => level === "manage";

/** Which runs of a project a person reaches: every one, only the ones they started, or none. */
export type RunReach = "all" | "own" | "none";

/**
 * Whoever edits sees every run; whoever only uses sees their own. A viewer sees every run of a
 * project open to the organization (as always), but a viewer let into a restricted project is held
 * to their own runs, like who only uses it: the runs carry other people's inputs. A viewer starts
 * no run, so in practice they see none there.
 */
export const runReach = (level: GraphAccessLevel, mode: GraphAccessMode | undefined): RunReach => {
  if (level === "manage" || level === "edit") return "all";
  if (level === "use") return "own";
  if (level === "view") return mode === "restricted" ? "own" : "all";
  return "none";
};

/** A run as the access rules see it. */
export interface RunOwnership {
  startedByUserId?: string | null;
}

const startedBy = (run: RunOwnership, userId: string | undefined): boolean =>
  userId !== undefined && run.startedByUserId === userId;

/** See {@link runReach}. */
export const canSeeRun = (
  level: GraphAccessLevel,
  mode: GraphAccessMode | undefined,
  run: RunOwnership,
  userId: string | undefined,
): boolean => {
  const reach = runReach(level, mode);
  return reach === "all" || (reach === "own" && startedBy(run, userId));
};

/** Stopping a run, talking to its agents, typing in its terminals. */
export const canActOnRun = (
  level: GraphAccessLevel,
  run: RunOwnership,
  userId: string | undefined,
): boolean => canEditGraph(level) || (level === "use" && startedBy(run, userId));
