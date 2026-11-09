import { Menu, app, shell, type MenuItemConstructorOptions } from "electron";

const SITE = "https://github.com/rafaeldossanto/NeuronsAI";

/**
 * The application menu, in pt-BR. The differences between systems live here: macOS has the app menu
 * (about, hide, quit) first and no File > Quit; Windows and Linux put Quit under File. Developer
 * tools and reload are only in development builds.
 */
export function buildMenuTemplate(
  platform: NodeJS.Platform,
  developing: boolean,
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

  template.push({
    label: "Arquivo",
    submenu: mac
      ? [{ role: "close", label: "Fechar janela" }]
      : [{ role: "quit", label: "Sair", accelerator: "CommandOrControl+Q" }],
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

export function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildMenuTemplate(process.platform, !app.isPackaged)),
  );
}
