# Contribuindo com o Flyoff

O Flyoff usa GitHub Flow: `main` deve permanecer estável e todo trabalho entra
por pull request.

## Fluxo de trabalho

1. Atualize `main` e crie uma branch curta a partir dela.
2. Use um prefixo que revele a intenção: `feat/`, `fix/`, `refactor/`, `docs/`
   ou `chore/`.
3. Faça commits pequenos no formato Conventional Commits, por exemplo
   `fix: stabilize editor word selection`.
4. Abra o pull request cedo como rascunho quando precisar acompanhar decisões
   ou dividir o trabalho.
5. Mantenha a branch atualizada, resolva as verificações da CI e marque os
   testes manuais executados.
6. Faça squash merge depois da revisão. O título do pull request será o commit
   que entra em `main`.

Branches de release ou de ambiente não devem acumular desenvolvimento. Builds
manuais são gerados pelo workflow de Windows; versões publicáveis usam tags
`vMAJOR.MINOR.PATCH` criadas a partir de `main`.

## Verificação local

Instale a versão de Node.js indicada em `package.json` e execute:

```console
npm ci
npm run verify
```

Mudanças que afetam integração, empacotamento ou interface também devem passar
por:

```console
npm run package
npm run test:e2e
node tests/smoke/verify-package.mjs
node tests/smoke/packaged-smoke.mjs
```

No Linux sem sessão gráfica, rode os testes Electron e o smoke test com
`xvfb-run --auto-servernum`.

## Interface e comportamento

- Siga [AGENTS.md](AGENTS.md), inclusive as regras de movimento, acessibilidade
  e compatibilidade com Windows, macOS e Linux.
- Registre no pull request os fluxos verificados manualmente e o resultado
  esperado.
- Inclua imagens somente quando elas ajudarem a avaliar uma mudança visual.
- Não introduza dependências sem justificar a necessidade e o custo de
  manutenção.

## Pull requests

Um pull request deve ter um objetivo único, explicar riscos observáveis e
informar como a mudança foi validada. Alterações no processo principal, preload,
persistência, criptografia ou contratos compartilhados exigem testes de fronteira
e uma descrição explícita do impacto de segurança.
