import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdateNotice, type DesktopUpdateState, type DesktopUpdates } from "./update-notice";

function fakeUpdates(initial: DesktopUpdateState) {
  const install = vi.fn(() => Promise.resolve());
  let push: (state: DesktopUpdateState) => void = () => undefined;
  const updates: DesktopUpdates = {
    getUpdateState: () => Promise.resolve(initial),
    installUpdate: install,
    onUpdateState: (callback) => {
      push = callback;
      return () => undefined;
    },
  };
  return { updates, install, push: (state: DesktopUpdateState) => push(state) };
}

describe("UpdateNotice", () => {
  it("shows nothing while there is no update to act on", async () => {
    const { updates } = fakeUpdates({ kind: "downloading", version: "0.2.0" });
    const { container } = render(<UpdateNotice updates={updates} />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the restart when the update is ready", async () => {
    const { updates, install } = fakeUpdates({ kind: "ready", version: "0.2.0" });
    render(<UpdateNotice updates={updates} />);
    await userEvent.click(await screen.findByRole("button", { name: "Reiniciar para atualizar" }));
    expect(install).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Nova versão pronta (0.2.0)");
  });

  it("links to the download when the system cannot update itself", async () => {
    const url = "https://github.com/rafaeldossanto/NeuronsAI/releases/tag/v0.2.0";
    const { updates } = fakeUpdates({ kind: "manual", version: "0.2.0", url, reason: "mac" });
    render(<UpdateNotice updates={updates} />);
    expect(await screen.findByRole("link", { name: "Baixar a nova versão" })).toHaveAttribute(
      "href",
      url,
    );
    expect(screen.getByRole("status")).toHaveTextContent("depende da assinatura");
  });

  it("can be dismissed for that version and reacts to new states", async () => {
    const { updates, push } = fakeUpdates({ kind: "ready", version: "0.2.0" });
    render(<UpdateNotice updates={updates} />);
    await userEvent.click(await screen.findByRole("button", { name: "Depois" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    push({ kind: "ready", version: "0.3.0" });
    expect(await screen.findByRole("status")).toHaveTextContent("0.3.0");
  });
});
