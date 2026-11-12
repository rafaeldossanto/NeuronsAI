# Estrutura do projeto

Organização por domínio consolidada em **07/11/2026**. O monorepo mantém aplicações em
`apps/` e contratos/bibliotecas reutilizados em `packages/`. Dentro de cada aplicação,
o primeiro nível de `src/` indica a responsabilidade do código.

## Mapa do monorepo

```text
NeuronsAI/
├── apps/
│   ├── server/           API, regras de negócio, persistência e execução
│   ├── web/              Interface React
│   ├── desktop/          Electron e integração com o computador
│   └── site/             Landing e instruções de instalação
├── packages/
│   ├── graph-schema/     Contrato, validação e templates de grafos
│   ├── providers/        Provedores de modelos, capacidades e estimativa de custo
│   ├── agent-runtimes/   Execução dos agentes e integração com CLIs
│   ├── tools/            Ferramentas HTTP, MCP e Obsidian
│   ├── mcp-neurons/      Servidor MCP e comunicação dos agentes
│   ├── runner-protocol/  Contrato entre servidor e runner
│   ├── runner/           Processo que hospeda agentes remotamente
│   └── api-client/       Cliente tipado e arquivos gerados do OpenAPI
├── Docs/                 Documentação e plano de implementação
├── spikes/               Experimentos isolados
└── .github/workflows/    Verificações e distribuição
```

## Servidor

O servidor já tinha módulos por domínio; essa divisão foi preservada. Controllers,
serviços, repositórios, erros e testes permanecem juntos no módulo correspondente.

| Pasta em `apps/server/src/` | Responsabilidade |
| --- | --- |
| `accounts/` | Autenticação, organizações, sessões, convites e autorização |
| `graphs/` | Grafos, rascunhos, versões e publicação |
| `runs/` | Início, consulta e encerramento de execuções |
| `run-log/` | Registro de eventos, mensagens e consumo das execuções |
| `hub/` | Coordenação dos agentes e ciclo de vida de uma execução |
| `agents/` | Integração dos runtimes com o servidor |
| `runners/` | Cadastro, conexão e seleção dos runners |
| `memories/` | Memórias, importação, cotas e acesso às ferramentas |
| `connections/` | Conexões com provedores e CLIs |
| `secrets/` | Armazenamento e acesso a credenciais |
| `triggers/` | Webhooks e agendamentos |
| `guards/` | Limites e proteção da execução |
| `realtime/` | WebSocket e eventos ao vivo |
| `database/` | Conexão, esquema e infraestrutura de persistência |
| `api/` | OpenAPI, contratos HTTP e utilitários de integração |
| `ui/` | Entrega dos arquivos estáticos da interface e landing |
| `health/` | Verificação de disponibilidade |
| `shared/` | Configuração e infraestrutura comum aos módulos |

As migrações e seus metadados continuam em `apps/server/drizzle/`. Os arquivos de
inicialização e composição da aplicação continuam na raiz de `src/`.

## Interface web

```text
apps/web/src/
├── accounts/             Organizações, membros, convites e conta do desktop
│   └── auth/             Sessão, login e renovação da autenticação
├── graphs/               Páginas de projetos e consultas de grafos
│   ├── editor/           Canvas, inspetor, modelo e campos específicos do grafo
│   └── templates/        Seleção visual de modelos de projeto
├── runs/                 Histórico, filtros, tabela e página da execução
│   └── live/             WebSocket, eventos, replay, terminal e painel do agente
├── runners/              Página de cadastro e gerenciamento de runners
├── memories/             Cadastro, importação e tipos das memórias
├── connections/          Painel de conexões e credenciais dos provedores
├── triggers/             Consultas e comandos dos gatilhos
├── settings/             Configurações do aplicativo desktop
├── updates/              Aviso e ações de atualização do desktop
├── shell/                Navegação, layout e moldura da janela
├── workspace/            Composição dos recursos e abertura dos painéis
├── shared/               Cliente HTTP, formatação, estados e componentes comuns
│   └── ui/               Botões, campos, cartões e outros controles reutilizados
├── test/                 Preparação do ambiente e helpers compartilhados de teste
├── app.tsx               Composição dos providers e declaração das rotas
├── main.tsx              Ponto de entrada
├── config.ts             Leitura validada da configuração da interface
└── styles.css            Estilos e tokens visuais globais
```

Páginas e testes ficam no domínio da funcionalidade. A pasta central `routes/` foi
substituída pelas páginas em `graphs/`, `runs/`, `accounts/`, `runners/` e `settings/`;
as URLs continuam declaradas em `app.tsx`. As consultas antes reunidas em
`lib/queries.ts` foram distribuídas entre `graphs/`, `runs/` e `triggers/`.

Os campos que configuram blocos de memória e acesso à IA pertencem ao inspetor em
`graphs/editor/`; os controles de formulário reutilizáveis ficam em `shared/ui/fields.tsx`.
`workspace/` compõe memórias e conexões para a aplicação; os painéis e tipos pertencem
aos seus respectivos domínios. O cliente HTTP compartilhado integra a política de
sessão definida em `accounts/auth/`.

## Desktop

```text
apps/desktop/src/
├── accounts/             Login nativo, sessões remotas e armazenamento de contas
├── settings/             Persistência das preferências e IPC das configurações
├── updates/              Atualizador e política de atualização
├── shell/                Menu, atalhos e controles da janela
├── security/             Isolamento da janela, política de requisições e chave mestra
├── server/               Inicialização e configuração do servidor embutido
├── lifecycle/            Encerramento com limites de tempo
├── main.ts               Composição do aplicativo Electron
├── preload.cts           Ponte restrita entre a janela e o processo principal
├── config.ts             Único leitor das variáveis de ambiente do desktop
└── config.test.ts
```

Os pontos de entrada `main.ts` e `preload.cts` mantêm os caminhos esperados pelo
Electron (`dist/main.js` e `dist/preload.cjs`). Recursos de distribuição continuam
em `build/`, scripts em `scripts/` e saídas geradas em `dist/` e `release/`.

## Como adicionar código

- Coloque a funcionalidade no domínio responsável, com os testes ao lado do arquivo
  (`*.test.ts(x)` ou `*.int.test.ts`). Crie subpastas quando houver um conjunto coeso
  de arquivos, como `graphs/editor/` e `runs/live/`.
- No frontend, páginas, consultas e componentes específicos ficam no mesmo domínio.
  `app.tsx` apenas compõe providers e rotas; `shell/` cuida da navegação e da janela.
- Use `shared/` para infraestrutura e controles reutilizados. Regras específicas de
  grafos, contas ou execuções continuam em seus domínios.
- Compartilhe contratos entre aplicações por `packages/`. O web usa `api-client`;
  evite importar implementações internas de outra aplicação.
- Gere o cliente OpenAPI com `pnpm api:generate`; preserve migrações e arquivos
  gerados em seus locais próprios. `dist/`, `release/`, logs e dados locais são saídas,
  não pastas para código-fonte.
- Após uma movimentação, ajuste imports e referências na documentação e rode as
  verificações dos pacotes afetados. Para o desktop, confira também o smoke local.

## Glossário das telas (pt-BR)

Um termo por conceito, em toda a interface web. O código e a API seguem em inglês
(`graph`, `run`, `template`); só o texto de tela muda.

| Na tela | Evite | Observação |
| --- | --- | --- |
| projeto | grafo | O `graph` da API. "Meus projetos", "Criar projeto", filtro "Projeto". |
| execução | run, rodada | Cada vez que um projeto roda. "Executar" é o botão, "execução" o registro. |
| modelo | template | Projeto pronto para partir dele ("Ver modelos", "Usar modelo"). |
| replay | — | Mantido: palavra já corrente em português e usada no painel ao vivo. |
| runner | — | Mantido: termo do produto (computador que executa agentes). |
| organização / espaço | workspace | "Espaço" é só a organização atual no cabeçalho. |
| chave de API | segredo, token | "Segredo" aparece só onde o servidor já o chama assim. |

Pendências conhecidas, em pastas que a passada de refino não tocou: o editor
(`graphs/editor/`) ainda diz "grafo" em alguns textos.

## Validação desta reorganização

- Compilação, lint e checagem de tipos das aplicações web e desktop passaram, com
  as dependências do monorepo compiladas pelo Turbo.
- Web: **220 testes** em 26 arquivos; desktop: **115 testes** em 13 arquivos.
- Smoke do Electron a partir do código compilado: interface, CSP, IPC, banco,
  execução com agentes simulados, ferramenta e gravação de memória passaram.
  O app encerrou com código 0 em **0,8 s** e liberou a trava do banco.

Os testes usaram agentes simulados, sem chamadas pagas a provedores de modelos.
