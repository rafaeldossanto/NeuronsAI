import { describe, expect, it } from "vitest";
import { TerminalSizeNegotiation, isAllowedTerminalSize } from "./terminal-size.js";

const RUN = "0192f1c0-0000-7000-8000-000000000001";
const OTHER_RUN = "0192f1c0-0000-7000-8000-000000000002";

describe("TerminalSizeNegotiation", () => {
  it("gives the one viewer the size it asked for", () => {
    const sizes = new TerminalSizeNegotiation();
    expect(sizes.report({}, RUN, "Alfa", { cols: 100, rows: 30 })).toEqual({ cols: 100, rows: 30 });
  });

  it("takes the smallest columns and the smallest rows among the viewers, each on its own", () => {
    const sizes = new TerminalSizeNegotiation();
    sizes.report({}, RUN, "Alfa", { cols: 200, rows: 20 });

    expect(sizes.report({}, RUN, "Alfa", { cols: 90, rows: 60 })).toEqual({ cols: 90, rows: 20 });
  });

  it("lets a viewer that reports again replace its own size, not add a second one", () => {
    const sizes = new TerminalSizeNegotiation();
    const viewer = {};
    sizes.report(viewer, RUN, "Alfa", { cols: 80, rows: 24 });

    expect(sizes.report(viewer, RUN, "Alfa", { cols: 150, rows: 50 })).toEqual({
      cols: 150,
      rows: 50,
    });
  });

  it("keeps terminals apart: other agents and other runs do not interfere", () => {
    const sizes = new TerminalSizeNegotiation();
    sizes.report({}, RUN, "Alfa", { cols: 40, rows: 10 });

    expect(sizes.report({}, RUN, "Beta", { cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 40 });
    expect(sizes.report({}, OTHER_RUN, "Alfa", { cols: 120, rows: 40 })).toEqual({
      cols: 120,
      rows: 40,
    });
  });

  it("grows back when the smallest viewer leaves, and says nothing when nobody is left", () => {
    const sizes = new TerminalSizeNegotiation();
    const big = {};
    const small = {};
    sizes.report(big, RUN, "Alfa", { cols: 200, rows: 50 });
    sizes.report(small, RUN, "Alfa", { cols: 80, rows: 24 });

    expect(sizes.forget(small)).toEqual([
      { runId: RUN, agent: "Alfa", size: { cols: 200, rows: 50 } },
    ]);
    expect(sizes.forget(big)).toEqual([{ runId: RUN, agent: "Alfa", size: undefined }]);
    expect(sizes.current(RUN, "Alfa")).toBeUndefined();
  });

  it("forgets a viewer only for the run it left", () => {
    const sizes = new TerminalSizeNegotiation();
    const viewer = {};
    sizes.report(viewer, RUN, "Alfa", { cols: 80, rows: 24 });
    sizes.report(viewer, OTHER_RUN, "Alfa", { cols: 80, rows: 24 });

    expect(sizes.forget(viewer, RUN)).toHaveLength(1);
    expect(sizes.current(OTHER_RUN, "Alfa")).toEqual({ cols: 80, rows: 24 });
    expect(sizes.forget(viewer, RUN)).toEqual([]); // nothing left to forget there
  });

  it("drops a terminal whose session ended", () => {
    const sizes = new TerminalSizeNegotiation();
    sizes.report({}, RUN, "Alfa", { cols: 80, rows: 24 });
    sizes.drop(RUN, "Alfa");
    expect(sizes.current(RUN, "Alfa")).toBeUndefined();
  });
});

describe("isAllowedTerminalSize", () => {
  it.each([
    [20, 5, true],
    [120, 40, true],
    [400, 200, true],
    [19, 40, false],
    [401, 40, false],
    [120, 4, false],
    [120, 201, false],
    [0, 0, false],
    [-1, 40, false],
  ])("%i x %i -> %s", (cols, rows, allowed) => {
    expect(isAllowedTerminalSize(cols, rows)).toBe(allowed);
  });
});
