---
atualizado: 2026-11-06
status: implementação revisada e integrada em dev/main; aceitação Google real pendente
---

# T25 — Contas e isolamento

**Estado consolidado em 06/11:** fundação, login Google, sessão web, isolamento, runners e
login remoto do Electron foram revisados e integrados na dev e na main. A implementação
inclui convites, adoção de dados locais e cotas com as correções de concorrência. Falta a
aceitação com OAuth Google real, renovação e reabertura/cofre nos três sistemas. Andamento
central em [[Plano de Implementação]]; detalhes em [[T25 - Google e recursos por organizacao]]
e [[T25 - Desktop remoto]].

**Origem histórica:** Rafael autorizou em 2026-11-05 concluir a integração da T17 e começar a base da T25. O trabalho começou em `codex/t25-accounts-foundation`, na worktree `C:\Users\rafae\Work\NeuronsAI-codex-t25`, a partir do merge local da T17 (`88e63b8`). As referências a essa branch descrevem a entrega inicial, não uma integração ainda pendente.

## T25a — Fundação de contas e sessões

- Cadastro persistente de usuários, identidades OIDC, organizações e vínculos. Identidade é `issuer + subject`; email não une contas. Cadastro e organização pessoal são criados numa transação, inclusive com cadastros concorrentes.
- Papéis `owner`, `admin`, `member` e `viewer`. Leitura, escrita, gestão de membros e gestão de credenciais têm verificação por organização. Admin só gerencia membros/viewers; apenas owner gerencia admins/owners. Alterações concorrentes não removem o último proprietário.
- Sessões próprias por organização. Acesso de 15 minutos e duração absoluta de 30 dias; a renovação não amplia esse prazo. Tokens opacos de 256 bits, persistidos apenas como SHA-256.
- Renovação troca ambos os tokens. Credenciais consumidas são mantidas; reutilizá-las revoga a sessão inteira. A operação é serializada no banco e a revogação é confirmada mesmo quando a chamada é recusada. Duas renovações simultâneas não deixam duas credenciais válidas.
- Autenticação consulta o vínculo atual; alterações de papel valem na próxima consulta. Remover vínculo apaga suas sessões e credenciais por FK composta. Voltar à organização exige uma sessão nova.
- Interface `IdentityProvider`, hoje implementada pelo adaptador Google. `VerifiedIdentity` é exclusivamente saída de validação OIDC no servidor, nunca um objeto recebido do cliente.
- Migração aditiva `0006_accounts_foundation`: seis tabelas novas, sem alterar dados/tabelas anteriores. Nenhuma dependência adicionada.

Na entrega inicial T25a, o módulo não estava conectado ao AppModule. A continuação conectou o módulo com configuração opcional de contas em hybrid/hosted, proteção dos recursos, sessão web e testes com dois usuários. O login remoto do Electron também está integrado. O perfil local continua sem conta. **A aceitação Google real permanece pendente.**

## Escopo entregue e aceitação restante

1. **T25b — OIDC e transporte de sessão:** Google com PKCE S256, state e nonce de uso único, validação de assinatura/issuer/audience/expiração, retorno pelo navegador do sistema, sessões web com proteção CSRF e cookies seguros, armazenamento desktop por `safeStorage`. Não armazenar tokens privados de CLIs ou expor refresh token ao JavaScript da página.
2. **T25c — Isolamento dos recursos:** propriedade por organização em grafos/versões, execuções/eventos/mensagens, memórias e arquivos, segredos e gatilhos; contexto autenticado em REST, WebSocket, ferramentas e jobs. Migrar dados locais preservando o modo sem conta. Nunca aceitar `userId` ou organização arbitrária do corpo como autorização.
3. **T25d — Runners:** emissão/revogação por conta, nomes por organização, autorização do upgrade e seleção/retomada de agentes apenas em runners da mesma organização.
4. **Aceitação integrada:** isolamento de dois usuários por ID, enumeração, WebSocket, replay, webhook e ferramentas coberto por testes. Falta aceitar login Google e reabertura do desktop com credenciais reais; o módulo e o fluxo multiusuário opcionais já estão conectados.

O OAuth client Google do Rafael é necessário para a aceitação real de T25b; o adaptador e seus testes já foram entregues. Credenciais só em configuração local/Secrets Manager, nunca em notas, código ou chat. AWS, API paga e assinatura de instaladores continuam adiadas.

## Validação da entrega inicial — 2026-11-05

- 25 testes de integração de contas/sessões no PGlite e na suíte Postgres 18: identidade, concorrência, vínculos, papéis, expiração, hashes, renovação/replay, logout e remoção/reinscrição.
- Teste adicional de atualização: aplica as migrações até a T17, insere projeto, versão imutável, execução, evento e segredo; aplica a 0006 e compara os dados integralmente.
- Lint, tipagem, build, formatação e contrato OpenAPI conferidos. Suíte do servidor: 509 testes passaram, além do teste novo de atualização executado separadamente.
- Na primeira suíte Postgres, as 137 asserções passaram, mas um teste antigo de gatilhos deixou uma resposta sem aguardar e fechou o banco durante a operação. A fixture agora aguarda `reply` e o teardown aguarda execuções pendentes/em andamento antes de fechar. A suíte completa foi repetida: 12 arquivos, 137 testes, sem erros não tratados.

## Outras validações desta leva

- **T17:** revisão e integração local na `dev` (`88e63b8`); lint, tipagem, testes e build dos pacotes afetados, OpenAPI e formatação passaram. Os três templates foram criados, reabertos e publicados explicitamente no banco temporário; Pesquisa com revisor terminou com ask/reply via CLI simulada. Aceitação com API real continua dependente da T07.
- **T09:** leitura da nota `Cards/NeuronsAI - Plano e andamento.md` em `E:\Notes`, conectada em modo somente leitura; importação de cópia temporária, criação e edição nessa cópia; HTTP local e MCP stdio por `use_tool`, com seis `ToolCalled` bem-sucedidos. Hash da nota original preservado. Script local repetível em `C:\Users\rafae\Work\neurons-validation\t09-2026-11-05.mjs`, com repositório/cofre/nota recebidos por argumento. Escrita direta no cofre original e ferramentas internas da CLI não foram validadas.
- **T16a:** `demo:triggers` no servidor real, banco temporário e CLI simulada. Webhook correto aceito (202), repetição/assinatura inválida/expirada recusadas (401), API ausente na porta de gatilhos (404) e cron disparando em dois minutos consecutivos (08:27 e 08:28, America/Sao_Paulo). Interface do desktop permanece uma verificação separada.

Nenhuma chamada de modelo paga, infraestrutura AWS ou publicação de release nesta leva.

## Referências técnicas

- [OpenID Connect Core, identificadores estáveis](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability): usar issuer e subject, sem vincular contas por email.
- [RFC 9700, proteção de refresh tokens](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14): rotação, detecção de reutilização e revogação da família de credenciais.
