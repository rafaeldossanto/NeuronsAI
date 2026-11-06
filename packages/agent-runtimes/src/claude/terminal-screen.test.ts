import { afterEach, describe, expect, it } from "vitest";
import { sleep } from "./async.js";
import { TerminalScreen } from "./terminal-screen.js";

describe("TerminalScreen", () => {
  let screen: TerminalScreen | undefined;

  afterEach(() => screen?.dispose());

  /** The emulator parses asynchronously: give it a moment, as the runtime's polling does. */
  async function show(data: string): Promise<TerminalScreen> {
    screen = new TerminalScreen(80, 10);
    screen.write(data);
    await sleep(100);
    return screen;
  }

  it("resizes: more rows keep what a smaller screen would have scrolled away", async () => {
    screen = new TerminalScreen(10, 3);
    screen.resize(20, 5);
    screen.write("one" + "\r\n".repeat(4) + "five");
    await sleep(100);
    expect(screen.text()).toBe("one\n\n\n\nfive");
  });

  it("reads the rendered screen, not the raw escape sequences", async () => {
    const shown = await show("\x1b[2J\x1b[Hfirst\r\nsecond \x1b[1mbold\x1b[0m");
    expect(shown.text()).toBe("first\nsecond bold");
  });

  it.each([
    ["the plain footer", "> \r\n? for shortcuts"],
    ["the auto-mode footer", "> \r\n⏵⏵ auto mode on (shift+tab to cycle) · ← for agents"],
    ["the accept-edits footer", "> \r\n⏵⏵ accept edits on (shift+tab to cycle)"],
  ])("sees a free input box from %s", async (_name, data) => {
    expect((await show(data)).footer()).toBe("free");
  });

  it("sees a busy CLI from the spinner line, even though the input box is still on screen", async () => {
    const shown = await show("✻ Working… (3s · esc to interrupt)\r\n❯ \r\n? for shortcuts");
    expect(shown.footer()).toBe("busy");
  });

  it("does not guess when neither footer is there (a dialog, for instance)", async () => {
    expect((await show("Do you trust this folder?")).footer()).toBe("unknown");
  });
});
