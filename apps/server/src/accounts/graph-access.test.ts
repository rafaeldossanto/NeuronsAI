import { describe, expect, it } from "vitest";
import type { OrganizationRole } from "../database/schema/accounts.js";
import {
  canActOnRun,
  canEditGraph,
  canManageGraph,
  canReadDraft,
  canRunGraph,
  canSeeGraph,
  canSeeRun,
  runReach,
  resolveGraphAccess,
  type GraphAccessEntryFacts,
  type GraphAccessFacts,
  type GraphAccessLevel,
} from "./graph-access.js";

const person = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const openProject = { ownerUserId: stranger, accessMode: "organization" as const };
const restrictedProject = { ownerUserId: stranger, accessMode: "restricted" as const };

const granted = (level: "use" | "edit"): GraphAccessEntryFacts => ({ status: "granted", level });
const blocked: GraphAccessEntryFacts = { status: "blocked", level: null };
const requested: GraphAccessEntryFacts = { status: "requested", level: null };

const levelOf = (
  role: OrganizationRole,
  project: GraphAccessFacts,
  entry?: GraphAccessEntryFacts,
): GraphAccessLevel => resolveGraphAccess(project, { userId: person, role }, entry);

describe("resolveGraphAccess", () => {
  it("gives owners and admins of the organization full access, even blocked, in any mode", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(levelOf(role, restrictedProject)).toBe("manage");
      expect(levelOf(role, openProject)).toBe("manage");
      expect(levelOf(role, restrictedProject, blocked)).toBe("manage");
    }
  });

  it("gives the project's owner full access in a restricted project, unless their role only reads", () => {
    const own = { ownerUserId: person, accessMode: "restricted" as const };
    expect(levelOf("member", own)).toBe("manage");
    expect(levelOf("member", own, blocked)).toBe("manage");
    expect(levelOf("viewer", own)).toBe("view");
  });

  it("opens the project to every member by their role, except who was blocked", () => {
    expect(levelOf("member", openProject)).toBe("edit");
    expect(levelOf("viewer", openProject)).toBe("view");
    expect(levelOf("member", openProject, blocked)).toBe("none");
    expect(levelOf("viewer", openProject, blocked)).toBe("none");
    // What was granted while restricted does not lower the open access of the role.
    expect(levelOf("member", openProject, granted("use"))).toBe("edit");
    expect(levelOf("member", openProject, requested)).toBe("edit");
  });

  it("keeps a restricted project to who was granted, at the granted level", () => {
    expect(levelOf("member", restrictedProject)).toBe("none");
    expect(levelOf("member", restrictedProject, requested)).toBe("none");
    expect(levelOf("member", restrictedProject, blocked)).toBe("none");
    expect(levelOf("member", restrictedProject, granted("use"))).toBe("use");
    expect(levelOf("member", restrictedProject, granted("edit"))).toBe("edit");
  });

  it("never lets the role be exceeded: a viewer granted anything only views", () => {
    expect(levelOf("viewer", restrictedProject, granted("use"))).toBe("view");
    expect(levelOf("viewer", restrictedProject, granted("edit"))).toBe("view");
    expect(levelOf("viewer", restrictedProject)).toBe("none");
  });

  it("treats a project from before the access mode (no owner, no mode) as open", () => {
    expect(levelOf("member", { ownerUserId: null, accessMode: "organization" })).toBe("edit");
    expect(resolveGraphAccess({}, { userId: person, role: "member" }, undefined)).toBe("edit");
  });
});

describe("what each level may do", () => {
  const capabilities = (level: GraphAccessLevel) => ({
    see: canSeeGraph(level),
    draft: canReadDraft(level),
    run: canRunGraph(level),
    edit: canEditGraph(level),
    manage: canManageGraph(level),
  });

  it("keeps the ladder: manage > edit > use, with view reading only and none seeing nothing", () => {
    expect(capabilities("manage")).toEqual({
      see: true,
      draft: true,
      run: true,
      edit: true,
      manage: true,
    });
    expect(capabilities("edit")).toEqual({
      see: true,
      draft: true,
      run: true,
      edit: true,
      manage: false,
    });
    expect(capabilities("use")).toEqual({
      see: true,
      draft: false,
      run: true,
      edit: false,
      manage: false,
    });
    expect(capabilities("view")).toEqual({
      see: true,
      draft: true,
      run: false,
      edit: false,
      manage: false,
    });
    expect(capabilities("none")).toEqual({
      see: false,
      draft: false,
      run: false,
      edit: false,
      manage: false,
    });
  });

  it("shows who only uses the project just the runs they started", () => {
    const mine = { startedByUserId: person };
    const theirs = { startedByUserId: stranger };
    const trigger = { startedByUserId: null };
    for (const mode of ["restricted", "organization"] as const) {
      expect(canSeeRun("use", mode, mine, person)).toBe(true);
      expect(canSeeRun("use", mode, theirs, person)).toBe(false);
      expect(canSeeRun("use", mode, trigger, person)).toBe(false);
      expect(canSeeRun("use", mode, mine, undefined)).toBe(false);
      for (const level of ["edit", "manage"] as const) {
        expect(canSeeRun(level, mode, theirs, person)).toBe(true);
        expect(canSeeRun(level, mode, trigger, person)).toBe(true);
      }
      expect(canSeeRun("none", mode, mine, person)).toBe(false);
    }
  });

  it("holds a viewer let into a restricted project to their own runs, and leaves the open one as it was", () => {
    const mine = { startedByUserId: person };
    const theirs = { startedByUserId: stranger };
    const trigger = { startedByUserId: null };
    expect(runReach("view", "restricted")).toBe("own");
    expect(canSeeRun("view", "restricted", theirs, person)).toBe(false);
    expect(canSeeRun("view", "restricted", trigger, person)).toBe(false);
    expect(canSeeRun("view", "restricted", mine, person)).toBe(true);
    expect(runReach("view", "organization")).toBe("all");
    expect(canSeeRun("view", "organization", theirs, person)).toBe(true);
    expect(canSeeRun("view", "organization", trigger, person)).toBe(true);
    // A project from before the mode existed is open.
    expect(runReach("view", undefined)).toBe("all");
  });

  it("lets who only uses the project act on their own runs, and who only views act on none", () => {
    const mine = { startedByUserId: person };
    const theirs = { startedByUserId: stranger };
    expect(canActOnRun("use", mine, person)).toBe(true);
    expect(canActOnRun("use", theirs, person)).toBe(false);
    expect(canActOnRun("edit", theirs, person)).toBe(true);
    expect(canActOnRun("manage", theirs, person)).toBe(true);
    expect(canActOnRun("view", mine, person)).toBe(false);
    expect(canActOnRun("none", mine, person)).toBe(false);
  });
});
