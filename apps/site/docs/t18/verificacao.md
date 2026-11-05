# Verificação local da T18

Data: 2026-11-04. Worktree: `NeuronsAI-codex-t18`. Nenhum deploy ou workflow foi executado.

## Checagens

- `pnpm install --frozen-lockfile`: concluído, sem alterar dependências ou lockfile.
- `pnpm format:check`: verde.
- `pnpm turbo run lint typecheck test build --filter=./apps/site`: quatro tarefas verdes, com 25 testes.
- Conferência do diff: apenas `apps/site/**` e o novo `.github/workflows/pages.yml`.

## Navegador real, build de produção

Chrome headless local, desktop 1600×1000 e celular 390×844:

- HTML com zero scripts inline, zero elementos/atributos de estilo inline, zero violações de CSP e zero exceções JavaScript após a correção do teclado. Scripts, CSS e fontes carregaram da própria origem.
- Fundo computado `rgb(247, 247, 244)` (#F7F7F4), fonte Manrope, campo e botão da lista de espera desabilitados.
- A única requisição externa da landing foi o GET público de releases do GitHub, sem autenticação. A ausência real de release respondeu 404; a interface continuou com “Primeira versão em breve”. Esse erro HTTP esperado não é violação de CSP.
- Resposta simulada com versão v0.1.7: sete downloads habilitados, SHA256SUMS.txt disponível e macOS destacado com as duas arquiteturas. Essa versão é uma fixture de teste, sem release criada. Após a resposta simulada, o recarregamento comum reutilizou o cache, sem nova consulta à API.
- A detecção, seleção, cache, resposta ausente, erros e limites 403/429 também foram cobertos por testes simulados em Vitest.
- Contraste computado nos 57 trechos visíveis das novas seções: nenhum abaixo de 4,5:1.
- Sem overflow horizontal no documento em 390 px. CTA principal visível na primeira tela. Cards e instruções se organizam em uma coluna no celular. O grafo de demonstração e os blocos de comandos têm rolagem interna quando necessário.
- Seleção do agente QA com Enter, simulação iniciada por teclado e concluída. Menu móvel abre e Escape fecha, devolvendo foco ao controle.
- Build adicional com `NEURONS_SITE_BASE=/NeuronsAI/`: carregado em subpasta, inclusive ícone/fontes/assets, sem violações de CSP ou exceções. O CTA recebeu a URL configurada, e Open Graph recebeu o endereço absoluto do ícone.

As capturas PNG desta pasta mostram o build no navegador. Não são imagens geradas. `macos-release-simulada.png` usa resposta de API simulada; as demais capturas mostram o estado sem release pública.

## Limites da validação

Não existe instalador público para baixar e conferir seu SHA256 nesta tarefa. As instruções foram verificadas contra o README do desktop. Nenhum instalador, conta, dado pessoal ou serviço de lista de espera foi usado. GitHub Pages e Vercel não foram ativados. A escolha da hospedagem, da URL real do modelador e do destino da lista permanece com o Rafael.
