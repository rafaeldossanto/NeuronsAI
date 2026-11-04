# @neurons/site

Landing real trazida de `E:\Notes\Design\NeuronsAI\pagina-real\index.html`, preservando o neurônio animado, a demonstração e os formulários visuais existentes. Os formulários de conta ainda são demonstrações; não representam contas do NeuronsAI funcionando.

`pnpm --filter @neurons/site dev` abre o site em `http://127.0.0.1:5191`. O botão **Criar meu projeto** abre `http://127.0.0.1:5173/new` numa nova aba: rode também o web e a API. A demonstração da landing permanece independente dos projetos salvos.

`pnpm --filter @neurons/site build` gera `dist`. Para um domínio separado do modelador, configure `NEURONS_MODELER_URL` no ambiente do Vite antes do build. Sem essa configuração o build usa `/new`, para publicação conjunta com o servidor e a interface.

Para servir tudo na mesma origem, compile site/web e configure `NEURONS_UI_DIR` apontando para `apps/web/dist` e `NEURONS_LANDING_DIR` para `apps/site/dist` no servidor. O servidor serve a landing em `/`, o editor em `/new` e `/graphs/...`, e a API em `/api`.
