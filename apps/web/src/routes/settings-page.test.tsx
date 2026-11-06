import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTriggersView } from "@/components/desktop-settings";
import { renderApp } from "@/test/helpers";

const off: DesktopTriggersView = {
  enabled: false,
  port: 3101,
  environment: false,
  address: null,
  restartRequired: false,
  problem: null,
};

function installDesktop(initial: DesktopTriggersView, localResources = true) {
  let current = initial;
  const settings = {
    getTriggers: vi.fn(() => Promise.resolve(current)),
    setTriggers: vi.fn((value: { enabled: boolean; port: number }) => {
      current = {
        ...current,
        ...value,
        restartRequired: value.enabled !== (current.address !== null) || value.enabled,
      };
      return Promise.resolve(current);
    }),
    restart: vi.fn(() => Promise.resolve(true)),
  };
  vi.stubGlobal("neuronsDesktop", {
    platform: "win32",
    localResources,
    settings,
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    chooseDirectory: vi.fn(),
    isMaximized: () => Promise.resolve(false),
    onMaximized: () => () => undefined,
    getUpdateState: () => Promise.resolve({ kind: "idle" }),
    installUpdate: vi.fn(),
    onUpdateState: () => () => undefined,
  });
  return settings;
}

afterEach(() => vi.unstubAllGlobals());

describe("tela de configurações", () => {
  it("fora do aplicativo para computador só explica onde ela existe", async () => {
    renderApp("/settings", {});
    expect(
      await screen.findByText("Estas configurações são do aplicativo para computador"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
  });

  it("não aparece quando o app está aberto num servidor remoto", async () => {
    installDesktop(off, false);
    renderApp("/settings", {});
    expect(
      await screen.findByText("Estas configurações são do aplicativo para computador"),
    ).toBeInTheDocument();
  });

  it("está no menu do aplicativo e mostra os gatilhos desligados por padrão", async () => {
    installDesktop(off);
    renderApp("/settings", {});

    expect(await screen.findByRole("heading", { name: "Gatilhos externos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurações" })).toBeInTheDocument();
    expect(screen.getByLabelText("Receber chamadas externas (webhooks)")).not.toBeChecked();
    expect(screen.getByLabelText("Porta")).toHaveValue(3101);
    expect(screen.getByTestId("triggers-address")).toHaveTextContent("Desligado");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("liga com a porta escolhida, avisa que pede reiniciar e mostra o endereço local", async () => {
    const settings = installDesktop(off);
    renderApp("/settings", {});
    const toggle = await screen.findByLabelText("Receber chamadas externas (webhooks)");

    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Porta"), { target: { value: "4100" } });
    expect(screen.getByTestId("triggers-address")).toHaveTextContent("http://127.0.0.1:4100");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(settings.setTriggers).toHaveBeenCalledWith({ enabled: true, port: 4100 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Reinicie para aplicar");
    expect(screen.getByRole("link", { name: /túnel da Cloudflare/ })).toHaveAttribute(
      "href",
      expect.stringContaining("apps/server/README.md#"),
    );
  });

  it("reinicia o aplicativo pelo botão do aviso", async () => {
    const settings = installDesktop({ ...off, enabled: true, restartRequired: true });
    renderApp("/settings", {});

    fireEvent.click(await screen.findByRole("button", { name: "Reiniciar o NeuronsAI agora" }));

    await waitFor(() => expect(settings.restart).toHaveBeenCalledTimes(1));
  });

  it("não deixa salvar uma porta fora da faixa e explica", async () => {
    const settings = installDesktop(off);
    renderApp("/settings", {});
    fireEvent.change(await screen.findByLabelText("Porta"), { target: { value: "80" } });

    expect(screen.getByText("Use uma porta entre 1024 e 65535.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(settings.setTriggers).not.toHaveBeenCalled();
  });

  it("mostra o endereço de quem já está escutando", async () => {
    installDesktop({ ...off, enabled: true, address: "http://127.0.0.1:3101" });
    renderApp("/settings", {});
    expect(await screen.findByTestId("triggers-address")).toHaveTextContent(
      "http://127.0.0.1:3101",
    );
  });

  it("mostra o motivo quando a porta não abriu", async () => {
    installDesktop({
      ...off,
      enabled: true,
      restartRequired: true,
      problem: "Não foi possível abrir a porta 3101.",
    });
    renderApp("/settings", {});
    expect(await screen.findByText("Não foi possível abrir a porta 3101.")).toBeInTheDocument();
  });

  it("deixa a variável de ambiente mandar, sem permitir mudar", async () => {
    installDesktop({
      ...off,
      environment: true,
      enabled: true,
      address: "http://127.0.0.1:3200",
    });
    renderApp("/settings", {});

    expect(await screen.findByText(/NEURONS_HOOKS_PORT/)).toBeInTheDocument();
    expect(screen.getByLabelText("Receber chamadas externas (webhooks)")).toBeDisabled();
    expect(screen.getByLabelText("Porta")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("mostra a recusa do aplicativo em pt-BR", async () => {
    const settings = installDesktop(off);
    settings.setTriggers.mockRejectedValueOnce(new Error("Use uma porta entre 1024 e 65535."));
    renderApp("/settings", {});
    fireEvent.click(await screen.findByLabelText("Receber chamadas externas (webhooks)"));

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use uma porta entre 1024 e 65535.");
  });

  it("mostra erro e deixa tentar de novo quando não consegue ler", async () => {
    const settings = installDesktop(off);
    settings.getTriggers.mockRejectedValueOnce(new Error("Não foi possível ler."));
    renderApp("/settings", {});

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível ler.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { name: "Gatilhos externos" })).toBeInTheDocument();
  });
});
