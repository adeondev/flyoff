# Flyoff — Performance de notas grandes

> Documento de contexto/hand-off. Descreve o gargalo de performance de notas
> longas, o que já foi corrigido e o que falta. Escrito para ser lido por um
> humano **ou** por um assistente que vá continuar o trabalho.

Última atualização: contenção de linhas e blocos fora da tela aplicada; falta
refinar o caso de imagem com wrap e eliminar o reparse do preview.

---

## O problema

Abrir uma nota grande derruba o frame rate: as animações da interface engasgam
mesmo sem o usuário digitar. A causa foi medida, não é suposição.

Numa nota de 6000 linhas, por tecla:

| | custo |
|---|---|
| todo o JS + mutação de DOM (`reconcileSource`) | 9,3 ms |
| **layout do Blink** | **131,6 ms** |

94% do custo era layout, porque o documento inteiro fica no DOM e o navegador
precisa refazer o layout de tudo a cada mudança. Por isso qualquer animação
rodando junto perde o orçamento de frame.

Custo de parse puro no preview (JS, independente de engine): 13,8 ms com 1000
blocos, 33,8 ms com 3000 blocos.

---

## O que já foi feito

`content-visibility: auto` + `contain-intrinsic-block-size` fazem o Blink pular
layout e pintura do que está fora da tela. As linhas continuam todas no DOM, o
navegador só não gasta tempo com as invisíveis.

- CSS: `src/renderer/projects/projects.css`, linhas ~1332 (editor) e ~2205 (preview)
- `markFloatingMedia()` em `source-renderer.ts` e `markdown-render.ts` liga e
  desliga o atributo `data-floating-media` na raiz
- As classes `md-line--media` (`markdown-highlight.ts`) e `markdown-block--media`
  (`markdown-render.ts`) marcam linhas e blocos que carregam imagem

Resultado numa nota de 6000 linhas: 215 ms → 12 ms por tecla, e 325 ms → 40 ms
por frame de animação. No preview com 1000 blocos: 12 ms → 4 ms por frame.

O preview também tem reconciliação incremental de DOM em `renderMarkdownInto`
(`markdown-render.ts`): renderiza num container destacado e insere apenas os
blocos cujo HTML mudou, comparando com as assinaturas da renderização anterior —
e não com o DOM ao vivo, que os próprios callers mutam (legenda expandida, por
exemplo).

---

## O que falta

### 1. Documentos com imagem em modo `wrap` não recebem otimização nenhuma

Uma imagem `wrap` flutua para fora da própria linha e as linhas seguintes
contornam ela, o que só funciona enquanto compartilham o mesmo contexto de
formatação. `content-visibility` implica `contain: layout`, que quebraria isso.
A solução atual é grosseira: **uma** imagem `wrap` desliga a contenção do
**documento inteiro**.

Refinar para excluir apenas o intervalo de linhas realmente afetado pelo float
(do float até o `clear`), em vez de desistir do documento todo. Os seletores que
geram float estão em `projects.css`: `.md-source-image--wrap` no editor e
`.markdown-image--wrap`, `.markdown-media--wrap-left`, `.markdown-media--wrap-right`
no preview.

### 2. O preview reparseia e reconstrói todos os blocos a cada tecla

A reconciliação evita o layout dos blocos que não mudaram, mas o JS ainda
parseia o documento inteiro e constrói o DOM de todos os blocos, para depois
descartar 99,9% deles.

A correção real é diff em nível de fonte: dividir o markdown em blocos, comparar
com a versão anterior e só parsear e construir os que mudaram. Isso exige que a
AST carregue **offsets de origem por bloco**, o que ela não faz hoje — ver
`src/shared/markdown/parse.ts` e `src/shared/markdown/ast.ts`.

Atenção: `src/shared/markdown` também é usado pelo processo main
(`src/main/projects/project-service.ts`, `project-reference-index.ts`,
`project-link-maintenance.ts`). Mudanças no parser não podem quebrar esses usos.

Existe um padrão pronto para copiar: `src/renderer/projects/source-document-model.ts`
já faz exatamente esse diff de prefixo e sufixo com reuso, por linha, no editor
de fonte.

---

## Restrições que não podem ser violadas

- O editor de fonte é um `contenteditable` (`plaintext-only`). Cursor, seleção,
  find-in-page e copiar/colar precisam continuar funcionando sobre o **documento
  inteiro**, inclusive fora da tela. Isso foi validado para a solução atual numa
  linha 2500 posições abaixo do viewport e precisa continuar valendo.
- Floats precisam continuar escapando das linhas, senão o texto para de
  contornar as imagens.
- Alturas de linhas e blocos com imagem não podem ser estimadas, senão a barra
  de rolagem pula.

---

## Como verificar

- `npm run verify` (lint, typecheck, testes, nativos) precisa passar. Adicione
  testes para o que mudar.
- **Medir em Chromium de verdade.** Não use jsdom: ele não faz layout nenhum,
  então reporta números sem relação com o problema real — o gargalo é
  exatamente o que o jsdom não simula.

Para medir, rode o Electron headless: bundle um script de benchmark com esbuild,
carregue numa `BrowserWindow` com `webPreferences: { offscreen: true }`, injete o
CSS com `webContents.insertCSS()` e force layout lendo `offsetHeight`.

- Flags: `--no-sandbox --ozone-platform=headless --disable-gpu`
- É preciso `unset ELECTRON_RUN_AS_NODE` antes de rodar
- Injete o CSS com `insertCSS()`, **não** via `--define` do esbuild, que corrompe
  strings grandes e faz a regra silenciosamente não aplicar
- Em container Linux, o Electron precisa das libs de sistema (`libgtk-3-0t64`,
  `libatk1.0-0t64`, `libnss3`, `libgbm1`, entre outras)

Meça antes e depois e registre os números. Se a mudança não melhorar de forma
mensurável, não vale a complexidade.

---

## Armadilhas já encontradas

- Otimizar `hasCanonicalLines` e o loop de renumeração em `source-renderer.ts`
  rendeu ~4 ms de um problema de 140 ms. Micro-otimização de JS ali é ruído; o
  custo é layout.
- `markActiveLine` usa `querySelectorAll` e custa 0,09 ms com 6000 linhas. Não é
  gargalo, não mexa.
- A janela offscreen do Electron reporta `innerHeight = 1`, o que superestima o
  ganho do `content-visibility` — no app real umas 30 linhas ficam visíveis e
  são renderizadas. Use os números como ordem de grandeza, não valor absoluto.
- `content-visibility` foi descartado uma vez por causa dos floats, sem medição.
  O raciocínio sobre o float estava certo, mas abandonar a ideia inteira custou
  94% do ganho por um caso que afeta poucos documentos. Meça antes de descartar.
