---
tags: [neuronsai, visao, decisoes]
atualizado: 2026-11-06
fonte: E:\Notes\Cards\neuronsAI.md e E:\Notes\Cards\Graph - gestor visual de agentes.md
---

# NeuronsAI

Orquestrador visual de agentes de IA. Cada bloco do grafo é um agente independente do
fornecedor (nome/papel, contexto, modelo, esforço). **Agentes ligados por uma seta conversam
diretamente e em tempo real**, como os terminais do Orca, e tudo o que trocam fica visível
como no Camunda: quem falou com quem, o que cada um está fazendo agora e quanto custou.

## Estado da implementação — 2026-11-06

A visão descreve o produto e suas decisões; o andamento detalhado está no
[[Plano de Implementação]], seção "Estado consolidado". Editor, execução ao vivo, replay,
templates, memórias com escrita, runners e contas já estão integrados em dev/main.
Google real, agentes de API reais e os fluxos completos no app instalado ainda exigem
aceitação. Release pública, landing publicada, WhatsApp, AWS e assinatura de código
continuam pendentes.

Hoje o runtime de terminal executa **Claude Code**, em PTY ou stream-json. Codex, Gemini e
custom são possibilidades do contrato, com adaptadores ainda no backlog. Agentes de API
usam OpenAI/Anthropic dentro do servidor, com testes simulados; `packages/providers` agora concentra adaptadores, registro e cálculo versionado de uso, validados sem chamadas pagas. Tokens são registrados; o custo de API em USD é estimado apenas para modelos do catálogo e permanece desconhecido fora dele; orçamento em USD não é um teto garantido nesses agentes nem no PTY.

## Referências e o que pegar de cada uma

| Referência | O que o NeuronsAI pega |
|---|---|
| Orca | Agentes vivos ao mesmo tempo, cada um na sua sessão (inclusive CLIs como Claude Code e Codex num terminal de verdade), mandando mensagens endereçadas uns aos outros, com caixa de entrada durável, confirmação de entrega e `ask` para pergunta com resposta |
| Camunda | Visibilidade: definição versionada, cada execução fixa uma versão, estado por bloco, histórico |
| n8n | Ligar agente a MCPs, APIs e gatilhos (webhook, WhatsApp) |
| Grok / "Graph Engineering" | Agentes com papéis diferentes repassando trabalho, inclusive em leque (1 pedido → N agentes → 1 resposta) |
| draw.io + Excalidraw | Modelador livre: além dos blocos, notas, formas, grupos e texto soltos |

**Diferença para o Orca:** o Orca é focado em código e numa relação coordenador → workers
montada por comandos. No NeuronsAI a **topologia é desenhada** (quem fala com quem), qualquer
tipo de agente entra (por API ou por CLI) e o fluxo pode não ter nada de código (vendas,
atendimento, pesquisa, integrações).

## Exemplos de fluxo (ilustrações, não escopo fixo)

- **Venda:** agente atende no WhatsApp → fecha a venda → avisa o agente de pós-venda, que
  chama as APIs de pedido e entrega e pode perguntar de volta ao vendedor algum detalhe.
- **Pesquisa:** agente de pesquisa consulta o cofre Obsidian e um MCP, conversa com um agente
  revisor até chegarem numa resposta.
- **Desenvolvimento:** um agente principal recebe o pedido e conversa com outros agentes
  (CLIs em terminais) que implementam e revisam.

## Como a comunicação funciona

```mermaid
sequenceDiagram
    participant A as Agente A (API)
    participant H as Hub NeuronsAI
    participant B as Agente B (Claude Code no terminal)
    participant UI as Modelador (ao vivo)
    A->>H: send_message(to: "B", texto)
    H->>H: confere a seta A→B, grava a mensagem
    H-->>UI: MessageSent (pulso âmbar na seta)
    H->>B: entrega assim que B fica ocioso
    B->>H: ask(to: "A", pergunta)
    H->>A: entrega
    A->>H: reply(resposta)
    H->>B: resposta (o ask de B destrava)
```

- **Direto** do ponto de vista do agente: A escreve para B pelo nome, B recebe na própria
  sessão e responde, os dois vivos ao mesmo tempo. Ninguém no meio reinterpreta a mensagem,
  e não existe um "motor" decidindo quem roda depois.
- O **Hub** é só o carteiro: confere permissão, grava, entrega e avisa a tela. É ele que
  garante que nenhuma mensagem se perde e que tudo aparece no modelador.
- **Seta = permissão de iniciar conversa.** A→B deixa A escrever para B; B sempre pode
  responder a quem lhe escreveu. Seta dupla deixa os dois iniciarem.
- Cada agente recebe no início seu papel, seu contexto e a lista de **pares** (os blocos ligados
  a ele, com nome e papel).
- Ferramentas de comunicação de todo agente: `send_message(to, text)`, `ask(to, question)`
  (espera a resposta, com timeout), `reply(messageId, text)`, `list_peers()`, `finish(result)`.
- Mensagem que chega com o agente ocupado espera na caixa de entrada e é entregue quando ele
  termina o turno (no terminal: quando a CLI fica ociosa, como o `tui-idle` do Orca).
- Você também é um participante: dá para escrever para qualquer agente durante a execução.

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | **TypeScript ponta a ponta** (Node 24 + NestJS no servidor, React + React Flow no modelador) — **confirmado pelo Rafael em 2026-11-01** | Esquema do grafo num pacote só (zod) para modelador e servidor; SDK oficial de MCP, `node-pty` e xterm.js são do ecossistema Node; NestJS tem módulos e injeção de dependência no estilo do Spring |
| D2 | **App desktop para Windows, macOS e Linux** (Electron): o servidor roda dentro do app em localhost e a interface abre na janela; em desenvolvimento também roda no navegador — **aprovado pelo Rafael em 2026-11-01** | Pedido do Rafael: baixar e instalar em qualquer sistema. Electron porque o servidor é Node (NestJS + `node-pty`) e roda no próprio processo do app, a mesma base do Orca; Tauri exigiria empacotar um Node à parte |
| D3 | **Comunicação direta entre agentes vivos** (modelo do Orca) | Pedido do Rafael. Cada agente é uma sessão de longa duração com caixa de entrada; não é um fluxo em que um bloco termina e o próximo começa |
| D4 | **Hub próprio**: toda mensagem é gravada no Postgres antes da entrega, entregue na hora em memória, e reentregue se não houve confirmação | Visibilidade e durabilidade sem infraestrutura extra (sem Temporal, Camunda, Redis). Postgres 18 nativo já está na máquina |
| D5 | **Dois tipos de agente** atrás da mesma interface `AgentRuntime`: **API** (loop próprio, qualquer fornecedor por chave de API) e **Terminal** (CLI oficial num pseudo-terminal: Claude Code, Codex, Gemini CLI, Hermes, qualquer uma) | O de API dá controle fino de modelo, esforço e custo. O de terminal usa a CLI oficial que você já tem logada, do mesmo jeito que o Orca, inclusive com a sua assinatura (termos, conferidos no spike T05: o usuário pode logar o binário não modificado com a própria assinatura; um produto não pode rotear requisições pela assinatura dos usuários nem guardar tokens; controle por PTY não é citado — para vender, o padrão é chave de API) |
| D6 | Agentes de terminal falam com o Hub por um **servidor MCP `neurons`** configurado em cada sessão | A CLI chama `send_message`/`ask` como ferramenta normal, sem raspar texto do terminal |
| D7 | **Esforço normalizado em 5 níveis**: `low`, `medium`, `high`, `xhigh`, `max` | São os níveis do Claude (`output_config.effort`); cada adaptador traduz (OpenAI `reasoning_effort`, Gemini orçamento de raciocínio, flag/config da CLI quando existir) e satura no mais próximo. "ultracode" não é parâmetro de API |
| D8 | **Canvas executável tipado + camada livre** | Blocos e setas tipados viram agentes e permissões; formas, notas, grupos e texto são anotação no mesmo canvas |
| D9 | **Grafo versionado e imutável por execução** | Igual à definição de processo do Camunda |
| D10 | **Guardas obrigatórias**: máximo de mensagens por seta e por execução, detecção de pingue-pongue, orçamento em US$, timeout por agente, botão de parar | Com conversa direta, dois agentes podem ficar se respondendo para sempre |
| D11 | Código, banco e enums em inglês; texto de tela em pt-BR | Regra dos projetos novos do Rafael |
| D12 | **Banco embutido no app: PGlite** (Postgres compilado para WASM), com o mesmo schema e as mesmas migrations do Drizzle; Postgres externo continua opcional (desenvolvimento, testes de integração, futuro modo servidor) — **aprovado pelo Rafael em 2026-11-01** | Quem baixa o app não vai instalar Postgres. PGlite é Postgres de verdade (SQL, triggers e migrations iguais) rodando dentro do processo, e o Drizzle tem driver para ele; SQLite obrigaria a reescrever schema e triggers |
| D13 | **Custos por último**: chave de API (T04, T07) e assinatura de código (T23) | Decisão do Rafael. Até lá os agentes rodam pelo Claude Code com a assinatura dele, e os instaladores saem sem assinatura (aviso do sistema na primeira abertura, como no MiniInfos) |
| D14 | **Híbrido com runners plugáveis**: servidor central e Postgres (RDS) na AWS; os agentes rodam em *runners* que se conectam ao servidor — o app desktop (padrão), um servidor do próprio usuário ou, no futuro, runners hospedados pelo NeuronsAI na AWS (estilo Hostinger). Onde o agente roda é configuração, não código. Perfis: `local` (tudo no app, com PGlite), `hybrid` (servidor na AWS + runner no app), `hosted` (servidor e runners na AWS) — **decidido pelo Rafael em 2026-11-01** | Híbrido agora e fácil de mudar depois. O Hub fala com qualquer runner pelo mesmo protocolo versionado; o runner abre a conexão de saída para o servidor (funciona atrás de NAT). O login do Claude Code fica dentro do runner e é feito pelo próprio usuário; o servidor nunca guarda token de assinatura (termos de uso) |

## Arquitetura implementada (v1)

```mermaid
flowchart LR
    WEB["apps/web<br/>React + React Flow + xterm.js<br/>modelador, conversas e terminais ao vivo"] -- REST + WebSocket --> SRV
    subgraph SRV["apps/server (NestJS)"]
      HUB["Hub de mensagens<br/>permissões, entrega, confirmação"]
      SUP["Supervisor de agentes<br/>sobe, entrega, para"]
      APIRT["Runtime API<br/>SDKs OpenAI e Anthropic"]
      REMOTE["RemoteAgentRuntime<br/>protocolo de runner v1, revisão 4"]
    end
    HUB <--> DB[("PGlite local ou Postgres externo<br/>mensagens, eventos, execuções, contas")]
    SUP --> APIRT
    SUP --> REMOTE
    REMOTE <-->|"canal em memória local<br/>ou WebSocket hybrid/hosted"| RUNNER["packages/runner<br/>runtimes Claude Code + MCP neurons"]
    RUNNER --> CLI["Claude Code<br/>PTY ou stream-json"]
    APIRT --> TOOLS["MCP · HTTP · Obsidian"]
    SCHEMA["packages/graph-schema (zod)"] -.-> WEB
    SCHEMA -.-> SRV
```

- **Monorepo pnpm + Turborepo:** quatro apps (`server`, `web`, `desktop`, `site`) e oito pacotes (`graph-schema`, `providers`, `agent-runtimes`, `tools`, `mcp-neurons`, `runner-protocol`, `runner`, `api-client`). Contratos e ferramentas são compartilhados; os adaptadores de API ainda estão no servidor.
- **Desktop local:** Electron incorpora servidor, runner e PGlite. A conexão remota abre a interface de outro servidor; ainda não inicia automaticamente um runner local para ele.
- **Banco:** PGlite por padrão no app; Postgres externo opcional, com o mesmo schema e migrations Drizzle. O desenvolvimento com Postgres usa `neurons_dev` (porta 5432).
- **Portas de desenvolvimento:** servidor 3100, web 5173, site 5191. O desktop escolhe a porta local do servidor; a porta separada de gatilhos é opcional.
- **Distribuição:** pipeline para Windows NSIS, macOS dmg/zip arm64 e x64 e Linux AppImage/deb implementado; primeira release pública pendente. Windows e AppImage têm atualização pelo app; deb e macOS sem assinatura levam ao download manual. Assinatura/notarização e atualização automática macOS dependem da T23.
- **Ciclo de uma execução:** o gatilho manda a primeira mensagem ao agente de entrada; cada
  agente sobe na primeira mensagem que recebe e fica vivo; a execução termina quando um agente
  chama `finish`, quando todos estão ociosos com a caixa vazia e ninguém esperando resposta,
  ou quando você para.
- **Eventos** (append-only): `RunStarted`, `AgentStarted`, `AgentStateChanged`, `MessageSent`, `MessageDelivered`,
  `ToolCalled`, `UsageRecorded`, `AgentIdle`, `AgentFailed`, `RunFinished`. O modelador anima um
  pulso âmbar na seta a cada `MessageSent` (o mesmo pulso do neurônio da landing).

## Riscos

- **Mercado cheio:** n8n, Dify, Langflow, LangGraph Studio, Agent Builder da OpenAI, Orca e os
  multiagentes da Anthropic. Diferencial a defender: topologia desenhada, conversa direta entre
  agentes de qualquer fornecedor (API e CLI) e visibilidade nível Camunda.
- **Custo e laço infinito** com conversa livre: as guardas da D10 entram junto com o Hub, não depois.
- **Terminal no Windows:** provado no spike T05 (volta completa 3 de 3, ver `Docs/Spikes/Terminal.md`); o risco que sobra é a CLI mudar os textos de tela entre versões.
- **Injeção de prompt:** texto de fora (WhatsApp, páginas) chegando num agente com ferramentas.
  Agentes que recebem texto externo começam sem ferramenta de escrita.
- **WhatsApp:** só pela Cloud API oficial da Meta.
- **Multiplataforma:** o `node-pty` precisa ser recompilado para a versão do Electron em cada sistema (feito no CI); encerrar a árvore de processos muda por sistema (`taskkill` no Windows, grupo de processos no macOS/Linux); caminho e login do Claude Code CLI variam por sistema.
- **Segredos na nuvem:** com deploy na AWS, `process.env` só no módulo de config, segredos no Secrets Manager, nada de segredo em código, log, fixture ou evento; varredura de segredos no CI (gitleaks).

## Landing

A referência original em `E:\Notes\Design\NeuronsAI\pagina-real` já foi incorporada a
`apps/site`: neurônio de partículas grafite com pulsos âmbar, Manrope, fundo `#F7F7F4`,
downloads por sistema, instruções e CSP em meta. A publicação e os destinos públicos
continuam pendentes. A hospedagem estática usa o build completo; servir junto ao NestJS
ainda exige integrar seus assets e conferir headers, conforme a T18.

Plano de execução: [[Plano de Implementação]].
