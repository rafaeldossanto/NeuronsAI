# Correções de segurança — 06/11/2026

Esta rodada trata os seis achados da revisão local.

| Área | Proteção aplicada |
| --- | --- |
| Adoção do workspace local | Bloqueada por padrão. O operador autoriza uma organização por UUID; o proprietário ainda precisa confirmar a operação. O destino fica vinculado em arquivo no diretório de dados para proteger retomadas. |
| Credenciais de agentes | Referências por `runtime.secretName` exigem owner/admin na publicação, assim como os marcadores `{{secret:...}}`. |
| Versões anteriores | A migração `0013_credential_approval` acrescenta a aprovação à versão. Execuções novas e recuperação após reinício recusam credenciais de versões organizacionais não aprovadas. Republicar com owner/admin aprova a nova versão. Membros continuam podendo executar versões aprovadas. |
| Ferramentas HTTP/MCP | Status inválidos e exceções na montagem da resposta rejeitam a chamada e encerram o stream, sem escapar do callback e encerrar o servidor. |
| API e WebSocket sem conta | Conferem Host e Origin antes de atender HTTP e upgrades. Páginas de outras origens são recusadas. Clientes sem Origin continuam sujeitos à validação do Host. |
| Escrita de memórias | Criação e edição de notas verificam o aumento de bytes antes de gravar. Importações e operações de notas compartilham a fila por organização no processo do servidor. Reduzir uma nota permanece permitido mesmo acima da cota. |
| Argumentos do terminal | Modos desconhecidos, valores ausentes, modos proibidos e ocorrências repetidas de `--permission-mode` são recusados antes de construir os argumentos de lançamento. |

O lockfile também substitui as versões vulneráveis de esbuild, glob e minimatch por versões corrigidas. A auditoria do lockfile atualizado retornou zero avisos nesta data.

## Atualização da instalação

1. Aplicar as migrações no Postgres com o procedimento normal do projeto. O banco embutido migra ao iniciar.
2. Republicar com owner/admin os grafos organizacionais antigos que usam credenciais. Versões antigas permanecem preservadas, mas não são autorizadas a iniciar ou retomar esse uso.
3. Caso precise importar o acervo local, definir `NEURONS_LOCAL_DATA_ORGANIZATION_ID` com o UUID escolhido pelo operador e reiniciar o servidor. Preservar `local-data-adoption.json` com os backups do diretório de dados.
4. Interfaces de navegador devem usar a origem do servidor. O proxy de desenvolvimento traduz somente a origem local esperada na porta 5173.

Os testes de regressão cobrem autorização da migração e sua retomada, publicação de credenciais em agentes API/terminal, execução e recuperação de versões antigas, respostas HTTP inválidas, requisições HTTP e WebSocket entre origens diferentes, cota em notas concorrentes e argumentos duplicados.

Validação local concluída: 706 testes do servidor (incluindo PGlite), 115 do desktop, 219 da interface, 151 das ferramentas e 94 dos runtimes aprovados, totalizando 1.285; um teste das ferramentas permaneceu marcado como ignorado. Compilação, tipos e lint dos cinco pacotes passaram, assim como a checagem do cliente gerado da API. A migração foi exercitada no banco embutido; a aplicação em um Postgres de produção deve seguir o procedimento de atualização da instalação.
