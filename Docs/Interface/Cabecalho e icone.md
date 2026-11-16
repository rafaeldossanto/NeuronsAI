# Cabeçalho compacto e ícone

O cabeçalho mantém Meus projetos e Execuções. O botão de conta reúne conexões de IA,
chaves de API, conexão com servidor, configurações locais e, quando há sessão,
organizações, runners e saída da conta. As opções de IA e chaves abrem o painel
existente, sem alterar os fluxos de autenticação dos provedores.

A faixa separada de conexão do desktop e a faixa de saída da sessão foram removidas.
Na tela de entrada remota, continuam disponíveis Conectar servidor e Voltar ao local,
inclusive se a sessão expirou ou o servidor não respondeu.

O ícone aprovado é o núcleo de partículas preto com filamentos e fundo transparente.
O original fica em `apps/web/public/neurons-icon.png`, usado no cabeçalho e no favicon.
`pnpm --filter @neurons/desktop icon` copia esse PNG para `build/icon.png` e converte
os formatos ICO e ICNS com o conversor da versão fixada do electron-builder.
Não adicionar fundo branco nem redesenhar o arquivo ao regenerar os formatos.

A paleta da interface permanece clara, com destaques em âmbar. A reorganização da
barra interna do editor foi adiada: o trabalho paralelo de integração do Codex/ChatGPT
altera o domínio do editor e o painel de conexões. Esta entrega não modifica esses
domínios, contratos da API, runtimes, configurações do servidor nem dependências.

## Validação

- `pnpm format:check`: passou.
- `pnpm turbo run lint typecheck test build --concurrency=2`: 48 tarefas passaram.
- `pnpm api:check`: cliente em dia.
- `pnpm --filter @neurons/desktop smoke`: passou com agentes simulados, ferramenta,
  memória e encerramento normal do aplicativo.
- Menu conferido em janela desktop e em 390 px, sem transbordamento horizontal.
- Testes cobrem teclado, clique fora, formulário do servidor, chaves, organizações,
  saída da conta com sucesso e erro e retorno ao local com sessão remota expirada.
- Integração do servidor com Docker não executada: o servidor não foi alterado.
