---
atualizado: 2026-11-05
status: implementado em branch; revisão e aceitação real pendentes
---

# T25 — Google e recursos por organização

Continuação autorizada por Rafael em 2026-11-05: avançar nas partes que não dependem de credenciais reais, preservando as etapas com custo para o fim. Branch `codex/t25-accounts-foundation`, worktree `C:\Users\rafae\Work\NeuronsAI-codex-t25`.

## O que mudou

- **Google OIDC:** authorization code + PKCE S256, state/nonce e vínculo ao navegador. Tentativas de 10 minutos persistidas no banco; state e vínculo só como hashes, verifier cifrado com a chave mestra. Consumo atômico por DELETE RETURNING, inclusive com callbacks concorrentes. Troca do código somente por POST ao endpoint fixo do Google. JWT verificado com `jose@6.2.15`, JWKS Google, RS256 fixo, issuer/audience/azp/iat/exp/sub/nonce. Email não verificado é ignorado e não une contas. Erros do provedor não carregam código, token ou segredo na causa.
- **Sessão web:** cookies host-only de acesso/renovação, HttpOnly, Secure em HTTPS, SameSite e CSRF para alterações. Origem exata validada; callbacks são vinculados ao cookie de login. Rotação, logout e seleção de organização invalidam a sessão anterior. Respostas autenticadas usam no-store. Sem tokens de sessão em JSON, URL, localStorage ou preload.
- **Organizações:** API para listar/criar organizações, selecionar vínculo e listar/alterar membros. Ator sempre vem da sessão. Papéis e último proprietário continuam protegidos; admin não promove owners/admins.
- **Recursos:** projetos pertencem à organização; versões, execuções, mensagens, eventos e replay herdam a propriedade. Listagens e totais são filtrados; IDs alheios retornam 404. Memórias ficam em diretórios por organização; cofre local/caminho bruto não é acessível em contexto de conta. Segredos com o mesmo nome são independentes, com AAD incluindo organização. Migrações mantêm o namespace local antigo e os dados existentes.
- **Execução em segundo plano:** escopo capturado para criação de runtime, resolução de segredos, ferramentas, conclusão e recuperação de runs, webhooks e timers. O dono é obtido do recurso persistido/registry, nunca de uma organização enviada pelo agente. Temporizadores guardam explicitamente o escopo, inclusive após reinício.
- **WebSocket:** origem, sessão, papel e propriedade verificados em subscribe e terminal.input. A entrega de eventos/histórico/saída também revalida a sessão; revogação/expiração fecha a conexão antes de novos dados.
- **Runners:** nomes únicos por organização, emissão/revogação autenticada com papel apropriado, token mostrado uma vez e omitido da lista. Upgrade continua autenticado por token; a identidade inclui a organização armazenada no servidor. Seleção e espera aceitam somente runners do mesmo namespace; embedded permanece local.
- **Interface web:** tela de entrada Google, estado de carregamento, falhas com nova tentativa, sessão expirada e sair. Cliente envia CSRF apenas à mesma origem e compartilha uma renovação entre chamadas concorrentes. Sem conta configurada, abre o workspace local normalmente.
- **Desktop:** continua com servidor embutido local e sem conta. Preparado `DesktopAccountStore`, exclusivo do processo principal, com safeStorage, isolamento por origem, gravação atômica e recusa de basic_text. O fluxo remoto do Electron ainda não está ligado; nenhum token novo foi exposto ao renderer.

MCP por stdio em contexto de organização é recusado no servidor compartilhado; use MCP por HTTP. Processos locais pertencem ao computador do runner. O modo local existente preserva MCP stdio.

## Configuração opcional

Sem as variáveis abaixo, o servidor mantém o workspace sem conta. Para testar contas num servidor hybrid/hosted, configure **fora do Git**:

| Variável | Valor esperado |
| --- | --- |
| `NEURONS_PROFILE` | `hybrid` ou `hosted` |
| `NEURONS_MASTER_KEY` | Chave de 32 bytes em base64, mantida estável |
| `NEURONS_PUBLIC_ORIGIN` | Origem HTTPS do aplicativo, sem barra final ou caminho |
| `NEURONS_GOOGLE_CLIENT_ID` | Client ID criado no Google Cloud |
| `NEURONS_GOOGLE_CLIENT_SECRET` | Client secret, apenas na configuração/Secrets Manager |
| `NEURONS_GOOGLE_REDIRECT_URI` | Mesma origem, retorno exato registrado no Google |

Com a interface servida pelo próprio servidor, o retorno é `/api/auth/google/callback`. Sem o prefixo de interface, use `/auth/google/callback`. HTTP só é aceito em loopback para desenvolvimento. As quatro variáveis de origem/Google devem estar juntas; contas exigem chave mestra e perfil hybrid/hosted. O aplicativo Electron remove essa configuração do servidor embutido para preservar o modo local.

Rotas: `/auth/session`, `/auth/google`, `/auth/google/callback`, `/auth/refresh`, `/auth/logout`, `/auth/organizations`, `/auth/organization`, `/auth/organizations/:id/members`, `/auth/organizations/:id/members/:userId` e `/runners`. Com a interface, acrescente `/api`. O OpenAPI e o cliente tipado foram regenerados.

## Verificação sem contas reais

- Suíte completa do servidor: **555 testes passaram**, e do Postgres 18: **157 passaram**. Depois foram acrescentados dois cenários de retomada/agendamento: o arquivo de isolamento, agora com **13 testes**, foi repetido integralmente nos dois bancos e passou.
- Web: **166 testes**. Desktop: **33 testes**, incluindo o cofre protegido. Lint, tipagem e build dos pacotes afetados passaram.
- Electron real no Windows: smoke confirmou UI/CSP, moldura/IPC isolado, banco embutido, execução com CLI simulada e memória escrita pelo MCP/runner; trava liberada ao sair.
- Dois usuários testados contra listagens/totais, IDs alheios, versões, start/stop, mensagens/eventos, memórias/ferramentas, segredos homônimos, papéis, seleção de organização, callback, webhook e WebSocket. Revogação corta eventos novos. Seleção de runner testada também enquanto aguarda conexão.
- Teste de atualização aplica todas as migrações novas a uma base T17 e preserva projeto, versão imutável, execução, evento e segredo.
- Teste de reinício retoma/encerra runs com seus donos e recarrega/dispara cron de duas organizações. O teste revelou a necessidade de ligar explicitamente o escopo ao temporizador; corrigido com captura do contexto, sem depender da requisição de origem.
- Navegador real: entrada conferida em desktop e 390 px; sem rolagem horizontal. Capturas em `C:\Users\rafae\Work\neurons-validation\t25-login-desktop.jpg` e `t25-login-mobile.jpg`.
- Relatórios locais das suítes em `C:\Users\rafae\Work\neurons-validation\t25-*-20261105.json`. Nenhuma chave Google real, chamada paga de modelo, assinatura de instalador, AWS ou release nesta etapa.

## O que ainda falta na T25

1. Revisão e integração da branch na dev, com CI multiplataforma.
2. OAuth client Google e domínio/retorno reais para aceitação do login e renovação no navegador.
3. Fluxo remoto do Electron: servidor de destino, abertura do navegador do sistema, retorno por deep link/loopback e uso do cofre preparado, sem levar tokens ao renderer. O desktop atual continua local.
4. Tela de administração de organizações/membros e gerenciamento de runners; os endpoints e as regras já existem. A tela atual oferece entrada/saída, sem painel administrativo novo.

T25 permanece em andamento até a aceitação integrada. Não marcar a tarefa completa apenas porque os testes simulados passaram.

## Referências

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
- [jose — validação de JWT](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md).
- [RFC 9700 — proteção dos refresh tokens](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
