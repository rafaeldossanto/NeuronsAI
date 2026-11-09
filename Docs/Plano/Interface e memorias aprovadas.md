---
tags: [neuronsai, implementacao, interface, memorias]
atualizado: 2026-11-06
status: implementação revisada e integrada em dev/main; validações reais restantes no plano central
---

# Interface e memórias aprovadas

Execução autorizada por Rafael em 2026-11-04, a partir do card `E:\Notes\Cards\NeuronsAI - Modelador, conexoes e memorias - executar.md` e das cinco propostas em `E:\Notes\Imagens\NeuronsAI\2026-11-04`.

Origem histórica: branch `codex/modeler-connections-memories`, base `dcac972` (T12, T13,
T14a/b e desktop T21 já entregues). Esta entrega foi revisada e integrada na dev, estando
presente na main. O andamento atual está em [[Plano de Implementação]]; os resultados
datados abaixo preservam a validação da entrega de 04/11.

## Entregas

- [x] Landing real em apps/site, CTA Criar meu projeto abrindo /new numa nova aba; demonstração preservada.
- [x] Editor dedicado com biblioteca lateral, projeto sem nome, salvamento/reabertura.
- [x] Moldura Electron estilo Wallet, controles por IPC limitado com renderer isolado.
- [x] Acesso à IA por agente, seletor de segredos e conexão oficial da CLI local; sem conexões fictícias.
- [x] Memórias persistentes com cadastro local, criação e importação no servidor.
- [x] Obsidian com ícone de grafo, leitura/escrita e autorização por agente/conexão.
- [x] Ferramentas chegando ao agente pelo MCP e runner, com registro de chamadas.
- [x] Testes e revisão visual.

## Regras

- Contas por assinatura somente nos caminhos oficialmente suportados; não implementar reaproveitamento de tokens privados das CLIs no servidor. Integrações dependentes de aprovação externa devem ser declaradas indisponíveis.
- Importação cria cópia, não sincronização. A memória possui ID independente do caminho físico.
- Sem exclusão de notas. Escrita exige permissão do bloco e da ligação do agente. Edição verifica o conteúdo anterior.
- Importação não aceita fuga de diretório, duplicidade de nomes, pastas reservadas ou arquivos acima dos limites.
- Os caminhos locais só valem no computador responsável por esse cofre.

## Validação da entrega — 2026-11-04

- `pnpm turbo lint typecheck build --continue`: 36 tarefas passaram nos 12 pacotes.
- `pnpm format:check` e `pnpm api:check`: passaram.
- Servidor: suíte completa com 372 testes, mais 3 cenários novos de credenciais por agente. Interface: suíte completa com 74 testes, mais 3 cenários de importação ZIP/pasta. Todos passaram.
- Esquema, ferramentas, MCP, protocolo, runner e desktop passaram nas suítes afetadas; a asserção antiga de cinco ferramentas foi atualizada para sete e validada novamente.
- `pnpm --filter @neurons/desktop smoke`: Electron real no Windows, renderer isolado, preload/IPC, execução com CLI de teste, criação de nota pelo MCP/runner e liberação da trava ao sair.
- Navegador real, build compilado, 1600×1000: CTA mantém landing e abre nova aba, projeto sem nome vazio, importação de ZIP com notas/links/anexo, salvamento e reabertura, execução iniciada pelo editor e histórico das chamadas.
- A execução de teste leu `Projeto/Plano.md` e criou `Projeto/Resultado.md` na memória importada. Nenhuma chamada paga foi feita. Capturas reais com dados de teste em `E:\Notes\Imagens\NeuronsAI\2026-11-04\06-implementado-modelador-memoria.png` a `09-implementado-historico-memoria.png`.

## Limites atuais e próximas integrações

- Assinatura Claude: CLI oficial no computador local; em híbrido o login ocorre no runner. A interface não copia tokens privados. Login novo com conta real não foi realizado nesta validação.
- Assinatura ChatGPT: botão identificado como indisponível; a integração oficial e seus critérios ainda precisam ser implementados/habilitados. OpenAI e Anthropic por chave têm runtime implementado, validado com clientes simulados; teste pago com chaves reais permanece pendente.
- Memória local é acessível no perfil local. Selecionar e operar um cofre local em outro computador de runner ainda requer integração própria; use memória importada/criada no servidor para esse fluxo.
- Hospedagem precisa de volume persistente para o catálogo e os cofres. A T25 já acrescentou contas e isolamento por organização; sua aceitação com Google real permanece pendente. Sincronização contínua e implantação AWS ainda não foram entregues. Anexos são preservados, sem interpretação multimodal.
- Consumo de API registra tokens; custo USD permanece desconhecido até haver preços versionados. A guarda em USD não é um teto garantido nesses agentes.
- Moldura validada no Electron de código-fonte no Windows. O pipeline de instaladores e atualização da T22 já foi implementado, com empacotamento no CI dos três sistemas e smoke com CLI simulada no Windows. Publicação da primeira release, aceitação real de instalação/atualização e assinatura de código (T23) permanecem pendentes.

## Revisão

Revisão do trabalho do Codex feita em 2026-11-04 antes da integração na `dev` (leitura do diff inteiro e dos arquivos novos, checagens completas e testes automáticos).

### Conferido sem ressalvas

- **Electron:** `contextIsolation` e `sandbox` seguem ligados, sem `nodeIntegration`. O preload expõe só `neuronsDesktop` (minimizar, maximizar, fechar, escolher pasta, estado de maximização) por `contextBridge`, com canais fixos `neurons:*`; nenhum `ipcRenderer` cru. O processo principal valida a origem e o frame principal em cada chamada. A CSP do app não mudou (sem script inline nem `eval`).
- **Chave mestra:** gerada no primeiro uso e cifrada pelo `safeStorage` em `secrets-key.enc`; se o sistema só oferece o armazenamento básico (Linux `basic_text`), a proteção fica desligada em vez de gravar a chave em texto. Nenhum log ou resposta mostra segredos; o seletor lista só nomes; não há chave em fixture ou teste.
- **Assinaturas:** só o login oficial do Claude Code (`claude auth login`) no computador local; ChatGPT aparece indisponível; nada de reaproveitar token privado.
- **Memórias com escrita:** o servidor recusa `..`, caminho absoluto, `:`, nomes reservados do Windows, pastas que começam com ponto, duplicatas e arquivos acima dos limites (20 MB, 1000 arquivos). O cofre barra `.obsidian`, `.trash`, `.git` e `.neurons` sem diferenciar maiúsculas, e confere o caminho real (link simbólico) em cada pasta antes de criar. Criar usa `wx` (nunca sobrescreve), editar confere o conteúdo anterior e troca por arquivo temporário, não existe exclusão. O bloco precisa de `readOnly: false`; `readOnly: true` na ligação veta a escrita desse agente. O campo da ligação é opcional e, ausente ou `false`, não acrescenta restrição. ZIP: o navegador só extrai texto e caminhos; quem valida é o servidor.
- **Runtime de API:** chaves vêm só dos segredos; o SDK repete 429/5xx/rede com espera crescente (`maxRetries: 2`); o erro do provedor nunca vai para o evento (só uma mensagem fixa); `reportsCost = false`, então o custo desconhecido não vira 0.
- **`ToolCalled`:** o resumo guarda só `nodeId` e `path`, nunca o conteúdo da nota.
- **Regras gerais:** nenhum `process.env` novo fora dos módulos de configuração; o servidor continua só em `127.0.0.1`. Grafos antigos com `obsidian { vaultPath, readOnly: true }` continuam válidos.

### Correções feitas na revisão

1. **Dependências sem versão exata** (`openai ^7.47.0`, `@anthropic-ai/sdk ^1.4.0`): fixadas em `7.47.0` e `1.4.0`, que já eram as versões do lockfile.
2. **OpenAI com `store: false`:** os itens de raciocínio devolvidos à conversa só são aceitos com `include: ["reasoning.encrypted_content"]`; incluído no pedido (documentado; sem chamada real).
3. **Compatibilidade:** novo teste em `migrate-graph.test.ts` com um grafo salvo no formato antigo do cofre (somente leitura), que precisa sair do `migrateGraph` igual, sem `readOnly` nas ligações.

### Resultado das pendências da revisão — atualizado em 2026-11-06

- **T18 implementada; integração de hospedagem ainda pendente:** scripts/estilos da landing foram externalizados, há CSP em meta e os formulários fictícios foram removidos. O caminho `landingRoot` do servidor ainda entrega só o HTML e procura os assets na raiz web. Antes de publicar junto ao servidor, entregar os arquivos de `apps/site/dist` e conferir headers/CSP; a alternativa é hospedagem estática separada. Publicação e destino opcional da lista de espera continuam pendentes.
- **Baixa:** `bodyLimit` de 30 MB vale para todas as rotas do servidor, e não só para a criação de memórias. Se o servidor sair do loopback, restringir à rota de memórias.
- **Baixa:** `rename` na edição de nota cria o arquivo com modo `0600`, trocando as permissões da nota original (só importa em sistemas POSIX).
- **Média, T04/T07:** o runtime de API manda `reasoning.effort` (OpenAI) e `output_config.effort` (Anthropic) sempre; modelos que não aceitam o parâmetro vão falhar. Implementar o envio condicional por capacidade do modelo e validar com as chaves reais (hoje só testes simulados). A implementação e os testes simulados podem avançar antes da validação paga.
- **Baixa:** um grafo importado de fora pode apontar `vaultPath` para qualquer pasta do computador no perfil local, e as notas `.md` dela ficam graváveis se o bloco e a ligação permitirem. É escolha do desenho (o usuário monta o grafo), mas vale um aviso ao importar grafos (T-backlog "importar/exportar").
