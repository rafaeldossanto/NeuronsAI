# @neurons/desktop

App desktop do NeuronsAI (Electron 45) para Windows, macOS e Linux. O servidor NestJS roda **dentro do processo principal do app** (perfil `local`: o runner dos agentes também é embutido), com o banco PGlite embutido, e a interface do [`@neurons/web`](../web/README.md) abre na janela. Nada para instalar além do app (e do Claude Code CLI, para agentes de terminal reais).

## Como funciona

```
Electron (processo principal)
 ├─ servidor NestJS em 127.0.0.1:<porta livre escolhida pelo sistema>
 │    ├─ /      a interface (apps/web/dist), como app de página única
 │    ├─ /api   a API REST (o prefixo é removido antes de chegar aos controllers)
 │    ├─ /ws    WebSocket dos eventos de execução
 │    └─ runner embutido → Claude Code (PTY ou stream-json), servidor MCP `neurons`
 └─ janela (renderer isolado e sandboxed) → só fala com a origem do servidor
```

- **Pasta de dados e CLI do Claude:** vêm da configuração do servidor ([`apps/server`](../server/README.md): `NEURONS_DATA_DIR`, `NEURONS_CLAUDE_BIN`, ...). Padrão: `%APPDATA%\NeuronsAI`, `~/Library/Application Support/NeuronsAI` ou `~/.local/share/neuronsai`. O banco fica em `<pasta>/db` e os arquivos do próprio Electron em `<pasta>/electron`.
- **Duas travas:** só uma instância do app (`requestSingleInstanceLock`; abrir de novo traz a janela para a frente) e uma trava por arquivo (`<pasta>/db.lock`, com o PID) que impede dois processos de abrirem o mesmo banco, inclusive o servidor avulso. Uma trava deixada por um processo que morreu é retomada sozinha.
- **Segurança:** `contextIsolation`, `sandbox`, sem `nodeIntegration` e preload com ponte limitada a minimizar, maximizar, fechar, selecionar pasta e o aviso de atualização; CSP restritiva (enviada pelo servidor); todo pedido da janela que não vá ao servidor local é cancelado; permissões negadas; `window.open` e navegação para fora são bloqueados (links `http(s)` abrem no navegador do sistema).
- **Moldura:** janela transparente com cantos de 12 px, barra compacta, título central e controles à esquerda. O preload CJS roda no sandbox e valida origem/frame em cada chamada. Maximizar remove os cantos; restaurar repõe a moldura.
- **Chaves de API:** chave mestra gerada no primeiro uso e cifrada pelo `safeStorage` do sistema em `<pasta>/secrets-key.enc`. Se o sistema não oferece proteção adequada, o armazenamento fica desabilitado; `NEURONS_MASTER_KEY` explícita continua suportada.
- **Menu e atalhos** (`src/menu.ts`) em pt-BR, com a diferença de cada sistema num lugar só. Ferramentas do desenvolvedor só fora do build empacotado.
- O servidor MCP `neurons` (que o Claude Code inicia) roda com o próprio executável do app como Node (`ELECTRON_RUN_AS_NODE=1`).

## Rodar em desenvolvimento

```bash
pnpm install
pnpm --filter @neurons/desktop dev     # compila (inclui web e servidor) e abre o app
```

Com o CLI de mentira (grátis, sem login), como na demo do servidor:

```powershell
$env:NEURONS_DESKTOP_CLAUDE_COMMAND = (Get-Command node).Source
$env:NEURONS_DESKTOP_CLAUDE_ARGS = '["packages/agent-runtimes/test-fixtures/fake-claude.mjs"]'   # caminho absoluto
pnpm --filter @neurons/desktop start
```

Teste de aceitação (executa o app real oculto com pasta temporária, verifica preload e controles, publica um projeto com dois agentes, grava uma nota na memória pelo MCP/runner e confere a liberação da trava ao sair):

```bash
pnpm --filter @neurons/desktop smoke                          # do código-fonte
pnpm --filter @neurons/desktop smoke -- <caminho do NeuronsAI.exe/NeuronsAI>   # do app empacotado
```

## Gerar o build `--dir`

```bash
pnpm --filter @neurons/desktop build        # web, servidor e app
pnpm --filter @neurons/desktop dist:dir     # release/<sistema>-unpacked/ (sem instalador)
```

O `electron-builder` recompila o `node-pty` para o Electron (`@electron/rebuild`). No Windows isso exige o node-gyp achar o Visual Studio Build Tools; se ele não achar (o node-gyp 12 ainda não reconhece o Visual Studio 2026), o binário que já vem no pacote basta (é N-API, serve a qualquer versão do Electron): `pnpm --filter @neurons/desktop dist:dir -- --config.npmRebuild=false`. O CI roda `dist:dir` nos três sistemas.

O app empacotado usa `asar: true`: o código e as dependências ficam em `app.asar`, e só o que precisa ser arquivo de verdade fica em `app.asar.unpacked` (`asarUnpack`: o binário e o helper do `node-pty`: `prebuilds`, `build`, `third_party`). A interface (`extraResources`) fica numa pasta ao lado, fora do asar. O servidor MCP `neurons` roda dentro do asar (o executável do app como Node lê o asar).

## Instaladores e release

`electron-builder.yml` define os alvos: **NSIS** (Windows), **dmg + zip** (macOS, arm64 e x64; o zip é de onde o macOS atualiza) e **AppImage + deb** (Linux). Nada é assinado (T23). Instaladores locais: `pnpm --filter @neurons/desktop dist` (mesmo aviso do node-gyp no Windows: acrescente `--config.npmRebuild=false`, chamando `pnpm exec electron-builder --win nsis --publish never --config.npmRebuild=false`).

O workflow [`release.yml`](../../.github/workflows/release.yml):

- roda numa **tag `v*`** ou à mão (_Actions → Release → Run workflow_, entrada `publish`, padrão `false`);
- gera os instaladores nos três sistemas e sobe como **artefatos do workflow** (14 dias);
- com tag (ou `publish: true`) um último job cria um **rascunho** de release com instaladores, `latest*.yml` (o que o atualizador lê), blockmaps e `SHA256SUMS.txt`. Só esse job tem `contents: write`. Nenhum segredo além do `GITHUB_TOKEN` do próprio workflow.

### Como subir a versão

A versão do app é a de `apps/desktop/package.json`, e a tag tem de ser igual (`v0.1.0` ↔ `0.1.0`); se não bater, o workflow falha antes de construir qualquer coisa.

1. Na `dev`: edite `"version"` em `apps/desktop/package.json` (ex.: `0.1.0`), commit e merge na `main` por PR, como sempre.
2. Na `main` já atualizada: `git tag v0.1.0` e `git push origin v0.1.0`.
3. Espere o workflow terminar, abra o rascunho em _Releases_, confira os arquivos e os checksums e **publique**. Só depois de publicada a release os apps instalados enxergam a versão nova.

Teste sem publicar nada: `gh workflow run release.yml --ref dev -f publish=false` e baixe os artefatos da execução.

## Atualização automática

`electron-updater` (6.8.11) lê as releases publicadas deste repositório (público, sem token no app). O app confere 15 s depois de abrir e a cada 4 horas. Nunca instala sozinho: uma barra no topo avisa e o usuário decide. Se há execução em andamento, o app pergunta de novo antes de reiniciar.

| Sistema                | Comportamento                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows (NSIS)         | Baixa em segundo plano; barra "Nova versão pronta (X). Reiniciar para atualizar."; o instalador roda em silêncio e pede ao Menu Iniciar para reabrir o app (no teste local por sessão sem janela o app não reabriu sozinho: confira no seu desktop). |
| Linux AppImage         | Igual; ao reiniciar o app fecha e a nova AppImage é aberta pelo usuário.                                                                                                                                                                             |
| Linux `.deb`           | Não se atualiza sozinho: a barra diz "baixe a nova versão" e leva à página da release.                                                                                                                                                               |
| macOS (sem assinatura) | O Squirrel.Mac não aplica atualização em app sem assinatura: a barra diz "baixe a nova versão" e leva à release. **Depende da T23**: assinando, troque `MAC_BUILD_SIGNED` em `src/update-policy.ts`.                                                 |

Canais do IPC restrito (validados por origem e janela, como os controles da moldura): `neurons:update` (`state` | `install`) e o evento `neurons:update-state`. `NEURONS_DESKTOP_UPDATES=off` desliga a checagem (o smoke usa).

### Testar a atualização localmente (Windows)

O provedor `generic` serve só para teste e entra só no build de teste, por um arquivo de config que troca o bloco `publish` (o `electron-builder.yml` normal nunca o tem):

1. Copie `electron-builder.yml` para um arquivo temporário trocando `publish` por `provider: generic` / `url: http://127.0.0.1:8765`.
2. Gere duas versões: `electron-builder --config <arquivo> --win nsis --publish never --config.npmRebuild=false --config.extraMetadata.version=0.0.1 --config.directories.output=<pasta>/0.0.1` (e `0.0.2`).
3. Instale a 0.0.1 (`/S` instala em silêncio), sirva a pasta da 0.0.2 com `python -m http.server 8765 --bind 127.0.0.1` e abra o app (com `NEURONS_DATA_DIR` temporário): em poucos segundos a barra aparece. Ao reiniciar, o app passa a 0.0.2.
4. Desinstale (`Uninstall NeuronsAI.exe /S`).

## Primeira abertura sem assinatura (para a página de download)

Os instaladores ainda **não são assinados** (T23); o sistema avisa na primeira abertura. É esperado e dá para passar:

- **Windows (SmartScreen):** "O Windows protegeu seu computador" → **Mais informações** → **Executar assim mesmo**.
- **macOS (Gatekeeper):** "não é possível abrir porque o desenvolvedor não pôde ser verificado" → _Ajustes do Sistema → Privacidade e Segurança → Abrir assim mesmo_ (ou clique com o botão direito no app → **Abrir**). Em último caso: `xattr -dr com.apple.quarantine /Applications/NeuronsAI.app`.
- **Linux:** AppImage: `chmod +x NeuronsAI-*.AppImage` e abra. deb: `sudo apt install ./NeuronsAI-*.deb`.
- Confira o download pelo `SHA256SUMS.txt` da release.

## Variáveis de ambiente

Além das `NEURONS_*` do servidor (o app fixa o perfil `local`, o endereço `127.0.0.1` e a porta). Estas só servem a testes e demos (`.env.example`):

| Variável                         | Descrição                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `NEURONS_DESKTOP_CLAUDE_COMMAND` | Programa que roda no lugar do Claude Code CLI (o de mentira). Vazio: procura o CLI real. |
| `NEURONS_DESKTOP_CLAUDE_ARGS`    | Lista JSON dos argumentos que vêm antes dos do CLI. Só vale com a variável acima.        |

Só `src/config.ts` lê o ambiente (exceção no lint, como `packages/runner/src/config.ts`).

## Ícone

O desenho continua provisório;
`build/icon.png` é provisório (neurônio âmbar `#E9A15C` sobre grafite), gerado por `pnpm --filter @neurons/desktop icon`. Os três saem do mesmo desenho; para o definitivo, troque o desenho em `make-icon.mjs` (ou os arquivos) e rode de novo.
