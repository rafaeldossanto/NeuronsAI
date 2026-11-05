---
atualizado: 2026-11-05
status: implementado em branch; revisão e aceitação Google real pendentes
---

# T25 — Desktop remoto

Continuação autorizada por Rafael após os painéis administrativos. Branch `codex/t25-desktop-remote`, worktree `C:\Users\rafae\Work\NeuronsAI-codex-t25-desktop`, baseada em `b4165cc` do PR #10. A base de contas e os painéis continuam em revisão; não foram integrados na dev.

## Comportamento

- O app continua abrindo o espaço local sem conta por padrão. A moldura oferece **Conectar servidor**, com origem HTTPS; HTTP só em loopback para desenvolvimento. Não aceita caminho, credenciais, query ou fragmento no endereço.
- O servidor precisa oferecer a interface web e o protocolo nativo na API sob `/api`. A página remota fica isolada, sem Node, com contexto separado e rede restrita à origem escolhida. A política mantém HTTPS/WSS, sem aceitar downgrade para HTTP/WS.
- **Entrar com Google** no Electron chama o processo principal, que abre o navegador do sistema. O Google retorna ao servidor, que devolve apenas um código temporário ao callback local do app. O segredo OAuth do Google permanece no servidor; não precisa ser distribuído ao desktop.
- O app troca o código por sessão no processo principal. Credenciais entram em cookies host-only; acesso e renovação são HttpOnly. A renovação fica cifrada pelo safeStorage, por origem. Os cookies remotos usam partições Electron em memória, separadas também por porta, sem prefixo `persist:`. Nenhum token de sessão entra no preload, URL da interface, localStorage ou retorno de IPC.
- Ao reabrir, a renovação protegida restaura a sessão e é rotacionada. Mudanças de organização/renovações/logout feitos pela interface sincronizam o cofre a partir dos cookies HttpOnly. A atualização do cofre é serializada.
- **Voltar ao local** mantém a sessão protegida para abrir novamente. **Esquecer sessão salva**, disponível na página local, remove a conexão deste computador e tenta revogar a sessão no servidor. O espaço local e seus agentes continuam independentes do servidor escolhido.
- A moldura e o retorno ao local ficam disponíveis inclusive na tela de login ou falha de sessão. A página remota não pode trocar/esquecer o servidor configurado, abrir o seletor de pastas locais ou instalar atualizações; essas ações exigem a janela local. A ponte confere origem, janela ativa e frame principal.

Esta etapa conecta a interface ao servidor. Não inicia um runner local automaticamente: o cadastro/token e as instruções de execução continuam no painel Runners.

## Retorno e persistência

O app cria state e verifier aleatórios de 256 bits, usa desafio S256 e abre um listener efêmero apenas em `127.0.0.1`. O único caminho de retorno é `/neurons/callback`, com Host/porta e state exatos. O listener fecha após o retorno, cancelamento ou prazo de 10 minutos. A resposta local não inclui credenciais e usa no-store, no-referrer e CSP sem recursos externos.

O fluxo web Google existente continua com state/nonce, PKCE e cookie de vínculo. A migração `0011_desktop_login` adiciona tentativas nativas ligadas ao state OIDC e grants de um minuto. O código do grant é guardado apenas como hash, ligado ao desafio e retorno exatos. A troca consome o código atomicamente, inclusive sob concorrência; erros de verifier/retorno não consomem o grant legítimo. A sessão só é criada nessa troca. Remoção do vínculo antes da troca impede a sessão; a FK do grant acompanha o vínculo.

Rotas novas, com `/api` quando a interface é servida junto:

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/auth/desktop/config` | Informa disponibilidade e versão 1 do protocolo |
| GET | `/auth/desktop` | Inicia Google no navegador, com state, desafio e retorno local |
| POST | `/auth/desktop/exchange` | Troca código/verifier/retorno por sessão no processo principal |

A troca rejeita requisições identificadas como JavaScript de navegador por Origin/Sec-Fetch-Site. Código, verifier e credenciais não são expostos em mensagens de erro. O cliente nativo não segue redirecionamentos na troca/renovação. O OpenAPI e o cliente gerado foram atualizados.

## Verificação e limites

- Desktop: 64 testes, incluindo callback HTTP real em loopback, state incorreto, cancelamento antes/depois da abertura, expiração, PKCE, cookies, rotação/cofre por origem, conexão serializada e autorização da ponte. Acesso negado para subframe, outra janela/origem, troca de servidor pela página remota, seletor de pasta remoto e instalação de atualização pela página remota.
- Web: 186 testes na suíte completa, incluindo formulário de conexão, retorno ao local e login/cancelamento delegado ao main, sem login Google dentro da janela Electron.
- Servidor: 566 cenários validados; o arquivo de API/OpenAPI foi repetido integralmente, com 29 testes, após atualizar a enumeração das três novas rotas. O resultado integral do head final deve ser conferido no CI.
- Postgres 18: 31 testes de login nativo, OIDC e isolamento passaram. Os mesmos cenários nativos/OIDC passaram em PGlite. Incluem vínculo ao navegador, expiração, retorno/verifier errados, cancelamento, replay, concorrência, ausência de sessão antes da troca e remoção de membro.
- Smoke padrão do Electron real no Windows preserva UI/CSP/IPC, banco, execução com CLI simulada, memória MCP/runner e encerramento. A janela local foi observada com o novo controle de conexão.
- A automação de captura/input nativo do Windows falhou por timeout/ausência de geometria mesmo após recuperar a janela. O formulário foi conferido em navegador com o bundle real e ponte nativa simulada, em desktop e 390 px, sem overflow ou erros no console. Capturas em `C:\Users\rafae\Work\neurons-validation\t25-native-connect-desktop.jpg` e mobile. Essa prévia não substitui a aceitação completa do login remoto no Electron.

**Pendentes:** revisão dos PRs, aceitação com OAuth client Google real/domínio/retorno configurados e conferência manual completa no Electron, incluindo reinício com cofre real nos três sistemas. Não marcar T25 concluída pela aceitação simulada. Nenhuma conta real, agente pago, AWS, assinatura ou release nesta etapa.

## Referências

- [RFC 8252 — navegador externo, PKCE e retorno em loopback](https://www.rfc-editor.org/rfc/rfc8252.html).
- [Electron — Cookies](https://www.electronjs.org/docs/latest/api/cookies).
- [Electron — Session e partições](https://www.electronjs.org/docs/latest/api/session).
- [[T25 - Google e recursos por organizacao]].
