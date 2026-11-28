import { Menu, app, shell, type MenuItemConstructorOptions } from "electron";

import type { RunnerMode } from "../runner/runner-mode.js";
import type { RunnerView } from "../runner/runner-manager.js";

const SITE = "https://github.com/rafaeldossanto/NeuronsAI";

/** The "Runner deste computador" submenu: the choice and what the runner is doing. */
export interface RunnerMenu {
  view: () => RunnerView;
  choose: (mode: RunnerMode) => void;
}

const RUNNER_CHOICES: readonly { mode: RunnerMode; label: string }[] = [
  { mode: "personal", label: "Pessoal — só as minhas execuções" },
  { mode: "organization", label: "Organização — execuções de toda a equipe" },
  { mode: "off", label: "Desligado" },
];

function runnerSubmenu(runner: RunnerMenu): MenuItemConstructorOptions {
  const view = runner.view();
  return {
    label: "Runner deste computador",
    // Only a remote server has a runner choice; the local space already has its own.
    visible: view.remote,
    enabled: view.remote,
    submenu: [
      ...RUNNER_CHOICES.map(({ mode, label }): MenuItemConstructorOptions => ({
        label,
        type: "radio",
        checked: view.mode === mode,
        click: () => runner.choose(mode),
      })),
      { type: "separator" },
      { label: view.status, enabled: false },
    ],
  };
}

/**
 * The application menu, in pt-BR. The differences between systems live here: macOS has the app menu
 * (about, hide, quit) first and no File > Quit; Windows and Linux put Quit under File. Developer
 * tools and reload are only in development builds.
 */
export function buildMenuTemplate(
  platform: NodeJS.Platform,
  developing: boolean,
  runner?: RunnerMenu,
): MenuItemConstructorOptions[] {
  const mac = platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];

  if (mac) {
    template.push({
      label: "NeuronsAI",
      submenu: [
        { role: "about", label: "Sobre o NeuronsAI" },
        { type: "separator" },
        { role: "services", label: "Serviços" },
        { type: "separator" },
        { role: "hide", label: "Ocultar o NeuronsAI" },
        { role: "hideOthers", label: "Ocultar os outros" },
        { role: "unhide", label: "Mostrar tudo" },
        { type: "separator" },
        { role: "quit", label: "Encerrar o NeuronsAI" },
      ],
    });
  }

  const runnerItems: MenuItemConstructorOptions[] = runner
    ? [runnerSubmenu(runner), { type: "separator" }]
    : [];
  template.push({
    label: "Arquivo",
    submenu: [
      ...runnerItems,
      ...(mac
        ? [{ role: "close", label: "Fechar janela" } as const]
        : [{ role: "quit", label: "Sair", accelerator: "CommandOrControl+Q" } as const]),
    ],
  });

  template.push({
    label: "Editar",
    submenu: [
      { role: "undo", label: "Desfazer" },
      { role: "redo", label: "Refazer" },
      { type: "separator" },
      { role: "cut", label: "Recortar" },
      { role: "copy", label: "Copiar" },
      { role: "paste", label: "Colar" },
      { role: "selectAll", label: "Selecionar tudo" },
    ],
  });

  const developerItems: MenuItemConstructorOptions[] = developing
    ? [
        { role: "reload", label: "Recarregar" },
        { role: "toggleDevTools", label: "Ferramentas do desenvolvedor" },
        { type: "separator" },
      ]
    : [];
  template.push({
    label: "Exibir",
    submenu: [
      ...developerItems,
      { role: "resetZoom", label: "Tamanho padrão" },
      { role: "zoomIn", label: "Aumentar" },
      { role: "zoomOut", label: "Diminuir" },
      { type: "separator" },
      { role: "togglefullscreen", label: "Tela cheia" },
    ],
  });

  const windowItems: MenuItemConstructorOptions[] = mac
    ? [
        { role: "zoom", label: "Zoom" },
        { type: "separator" },
        { role: "front", label: "Trazer tudo para a frente" },
      ]
    : [{ role: "close", label: "Fechar" }];
  template.push({
    label: "Janela",
    submenu: [{ role: "minimize", label: "Minimizar" }, ...windowItems],
  });

  template.push({
    role: "help",
    label: "Ajuda",
    submenu: [{ label: "NeuronsAI no GitHub", click: () => void shell.openExternal(SITE) }],
  });

  return template;
}

/** Installs the menu and returns what redraws it (the runner's status changes while it is open). */
export function installMenu(runner?: RunnerMenu): { refresh: () => void } {
  const build = () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(buildMenuTemplate(process.platform, !app.isPackaged, runner)),
    );
  build();
  return { refresh: build };
}
