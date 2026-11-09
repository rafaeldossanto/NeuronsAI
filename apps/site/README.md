# @neurons/site

Landing do NeuronsAI com Vite, Manrope, fundo #F7F7F4, grafite e âmbar #E9A15C. Preserva o neurônio animado e o modelador de demonstração. O CTA **Criar meu projeto** abre o modelador real em outra aba; a demonstração não executa agentes nem grava projetos.

**Estado em 2026-11-06:** implementação revisada e integrada; publicação, hospedagem/URL
do modelador, destino opcional da lista e primeira release pública continuam pendentes.
Para hospedar junto ao NestJS, ainda é preciso integrar os assets da landing na entrega de
`landingRoot` e conferir headers/CSP; o caminho atual entrega só seu HTML. Hospedagem
estática deve publicar todo o `dist`. Andamento no
[plano consolidado](../../Docs/Plano/Plano%20de%20Implementação.md#estado-consolidado).

## Entrega T18

- Seção **Baixar** com detecção de Windows, macOS e Linux. O sistema detectado aparece primeiro e recebe destaque. No macOS, Apple Silicon e Intel ficam sempre disponíveis para escolha; não se infere a arquitetura pelo navegador. Linux oferece AppImage e deb x64.
- Os instaladores e SHA256SUMS.txt vêm, em tempo de execução, de `https://api.github.com/repos/rafaeldossanto/NeuronsAI/releases/latest`, sem autenticação. Os nomes são conferidos contra a versão da release e o padrão de artefatos da T22 (`win`, `mac`, `linux`; os aliases `windows` e `macos` também são aceitos). Blockmaps, metadados e outras versões não viram botões de download.
- Ausência de release, falha de rede, JSON inválido, erro da API e limite de requisições mantêm **Primeira versão em breve** e o link para Releases. Não são inventados endereços de instaladores. Cada formato só é habilitado quando seu arquivo existe.
- Cache em `sessionStorage`: 15 minutos para uma release válida e 5 minutos para indisponibilidade. Em 403/429, respeita também o reset informado pelo GitHub, limitado a uma hora. Sem repetição automática de chamadas; armazenamento bloqueado não interrompe a página. O cache não contém dados pessoais.
- Seção **Como instalar** em português, com SmartScreen, Gatekeeper, AppImage/deb e conferência de SHA256 em cada sistema. Os comandos usam VERSAO como marcador a substituir pelo nome exato do arquivo. A orientação parte do [README do desktop](../desktop/README.md), sem modificá-lo.
- Lista de espera desligada por padrão, com campo e botão desabilitados. Os antigos formulários visuais de nome/senha foram removidos. Nenhum serviço de terceiros foi conectado e nenhum dado pessoal é enviado pela lista.
- Scripts, CSS, dados das partículas e fontes locais foram separados em arquivos. A CSP em meta permite apenas scripts/estilos da própria origem e conexões à própria origem e à API pública do GitHub. Não usa `unsafe-inline` nem `unsafe-eval`.
- Metadados em pt-BR, Open Graph, favicon copiado de `apps/desktop/build/icon.png`, atalho para conteúdo, foco visível, contraste dos textos e layout para celular. Corrigido o acionamento por teclado dos blocos SVG na demonstração.
- Workflow de Pages preparado em [pages.yml](../../.github/workflows/pages.yml), apenas `workflow_dispatch`. Nenhum deploy, tag, release ou execução de workflow foi feito nesta entrega.

### Como testar localmente

Na raiz desta worktree:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @neurons/site dev
```

Abra `http://127.0.0.1:5191`. O CTA do modo dev usa `http://127.0.0.1:5173/new`; rode web/API separadamente para testar o modelador real. Nesta T18, apenas o site foi alterado.

Para conferir a CSP e os arquivos de produção, use:

```powershell
pnpm --filter @neurons/site build
pnpm --filter @neurons/site preview --host 127.0.0.1 --port 5192
```

Confira desktop e largura de 390 px. Teste Tab/Shift+Tab, menu com Escape, seleção de agentes com Enter/Espaço, simulação do fluxo e os detalhes de instalação. Na ausência de release pública, o estado esperado é “Primeira versão em breve”; um 404 do endpoint de releases é tratado pela página e não é uma violação de CSP.

Checagens exigidas antes do commit:

```powershell
pnpm format:check
pnpm turbo run lint typecheck test build --filter=./apps/site
```

Os testes simulam resposta com release, sem release, erro, limite 403/429, rede indisponível, cache vencido/bloqueado, nomes dos artefatos e detecção dos sistemas. Nenhum teste baixa instaladores ou precisa de conta.

### Configuração

| Variável                | Uso                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEURONS_MODELER_URL`   | Endereço do modelador real. Dev: `http://127.0.0.1:5173/new`; build padrão: `/new`, para servidor combinado. Em hospedagem estática, configure a URL HTTPS do aplicativo; Pages não hospeda o backend. |
| `NEURONS_SITE_BASE`     | Base dos arquivos do site. Padrão `./`; Pages usa `/NeuronsAI/`; domínio próprio pode usar `/`.                                                                                                        |
| `NEURONS_SITE_URL`      | URL pública final do site para gerar `og:image` absoluto. Sem ela, o metadado usa o ícone local relativo.                                                                                              |
| `VITE_WAITLIST_ENABLED` | Ausente/false mantém a lista desligada. Só o valor `true`, junto de URL válida, habilita o acesso ao destino.                                                                                          |
| `VITE_WAITLIST_URL`     | URL HTTPS escolhida pelo Rafael, sem credenciais no endereço. Nenhum destino padrão.                                                                                                                   |

O único leitor de `import.meta.env` é [src/config.ts](src/config.ts). Ativar a lista exige configurar os dois valores e fazer novo build. A landing passa a abrir a página escolhida para o visitante conferir e se cadastrar lá; não transmite o campo de e-mail nem faz POST. Antes de habilitar, Rafael deve escolher o serviço, revisar privacidade e atualizar o aviso correspondente. As variáveis VITE são públicas: não colocar segredos nelas.

A escolha de downloads está em [src/downloads.ts](src/downloads.ts). Alterações em fornecedor, formato ou arquitetura de instalador precisam de ajuste nessa seleção e nos testes.

### Publicação pelo GitHub Pages — somente quando o Rafael decidir

1. Decidir onde o modelador real ficará disponível e ter sua URL HTTPS. Não apontar o CTA para `/new` do Pages: Pages só serve arquivos estáticos.
2. Após revisão e inclusão do workflow na branch padrão do repositório, configurar manualmente **Settings → Pages → Build and deployment → Source: GitHub Actions**, se esta for a hospedagem escolhida. Nada disso foi ativado por esta tarefa.
3. Em **Actions → Landing no GitHub Pages → Run workflow**, selecionar a branch aprovada e informar `modeler_url`. Esta ação é uma decisão futura do Rafael; o workflow não roda em push, PR ou tag.
4. O build instala com lockfile congelado, executa as checagens do site e envia `apps/site/dist`. O job de deploy depende desse build e usa o ambiente `github-pages`. Só ele tem `pages: write` e `id-token: write`; o build só tem `contents: read`.

A landing agora tem arquivos externos de CSS, JavaScript, fontes e ícone. Caso seja servida junto ao servidor NeuronsAI, o host precisa entregar também esses arquivos de `apps/site/dist`, além do HTML. Esta T18 não altera as rotas nem os headers do servidor.

O workflow calcula a base `/NeuronsAI/` e a URL padrão do Pages. Para domínio próprio, ajustar essas variáveis no workflow antes da publicação. Ele não ativa Pages automaticamente e não publica releases do desktop.

### Alternativa: Vercel — somente quando o Rafael decidir

Importar o mesmo repositório como projeto Vite, escolher **Root Directory: apps/site**, instalação `pnpm install --frozen-lockfile`, build `pnpm build` e saída `dist`. Configurar `NEURONS_MODELER_URL` com o endereço real do aplicativo, `NEURONS_SITE_BASE=/` e `NEURONS_SITE_URL` com a URL pública escolhida. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` evita download desnecessário do Electron na instalação do monorepo. Revisar a publicação automática da Vercel antes de conectar o repositório. Nenhum projeto Vercel foi criado.

### O que depende do Rafael

- Destino e política de privacidade da lista de espera; permanece desligada até essa decisão.
- Hospedagem da landing (Pages, Vercel ou outra) e endereço público do modelador.
- Publicação da primeira release do desktop pelo processo da T22; até lá, o site apresenta o estado de espera.

### Prints e revisão no navegador

Capturas do build local, sem publicar. As imagens com release simulada são apenas validação e não indicam que já existe versão pública.

- [Desktop: hero](docs/t18/desktop-hero.png)
- [Desktop: downloads sem release](docs/t18/desktop-downloads.png)
- [Celular: hero em 390 px](docs/t18/mobile-hero.png)
- [Celular: downloads](docs/t18/mobile-downloads.png)
- [macOS: API simulada com os dois chips](docs/t18/macos-release-simulada.png)

Verificações e resultados finais em [docs/t18/verificacao.md](docs/t18/verificacao.md).

Referências: [API de releases](https://docs.github.com/en/rest/releases/releases#get-the-latest-release), [limites da API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [workflow de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [base pública do Vite](https://vite.dev/guide/build.html#public-base-path).
