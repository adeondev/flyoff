# Flyoff — Performance de notas grandes

> Documento de contexto/hand-off. Descreve o gargalo de performance de notas
> longas e as correções aplicadas. Escrito para ser lido por um
> humano **ou** por um assistente que vá continuar o trabalho.

Última atualização: contenção seletiva de floats e renderização incremental do
preview concluídas e medidas em Chromium.

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
- `markFloatContexts()` mantém sem contenção somente o intervalo entre um float
  e o heading que aplica `clear`
- As classes `md-line--media` (`markdown-highlight.ts`) e `markdown-block--media`
  (`markdown-render.ts`) marcam linhas e blocos que carregam imagem

Resultado numa nota de 6000 linhas: 215 ms → 12 ms por tecla, e 325 ms → 40 ms
por frame de animação. No preview com 1000 blocos: 12 ms → 4 ms por frame.

O preview também tem reconciliação incremental de fonte e DOM em
`renderMarkdownInto` (`markdown-render.ts`): uma varredura barata encontra os
limites dos blocos, o diff de prefixo e sufixo reutiliza a AST e os nós intactos,
e somente os blocos alterados passam por parse e construção de DOM.

---

## Implementação concluída

### Contenção seletiva de imagens em modo `wrap`

Uma imagem `wrap` flutua para fora da própria linha e as linhas seguintes
contornam ela, o que só funciona enquanto compartilham o mesmo contexto de
formatação. `content-visibility` implica `contain: layout`, que quebraria isso.

As classes `md-line--float-context` e `markdown-block--float-context` agora
excluem da contenção somente o float e os irmãos afetados até o heading que
aplica `clear`. O restante do documento continua usando `content-visibility`.
As exceções existentes para headings imediatamente após uma imagem e headings
com imagem inline continuam no mesmo contexto do float.

### Parse e DOM incrementais no preview

Todos os blocos da AST carregam `position.start` e `position.end` no texto de
origem. `splitMarkdownBlocks()` encontra as mesmas fronteiras sem executar o
parse inline. O renderer compara essas fatias com o estado anterior e só
reparseia e reconstrói o intervalo alterado.

Blocos reutilizados preservam identidade e mutações legítimas feitas pelos
callers. IDs, contagens e caminhos de headings são recalculados sem reconstruir
seus elementos quando um heading anterior muda.

### Resultado medido

Benchmark Electron 43/Chromium offscreen, viewport de 600 px:

| cenário | antes | depois |
|---|---:|---:|
| alteração central em preview de 3000 blocos | 80,7 ms | 4,2 ms |
| alteração em editor de 6000 linhas com `wrap` curto | 17,9 ms | 7,3 ms |

Os valores são medianas e incluem mutação de DOM e layout forçado por
`offsetHeight`. O benchmark reproduzível está disponível em
`npm run benchmark:large-notes`. Como controle da variância do Electron
headless, execuções alternadas no mesmo ambiente registraram 9,7 ms com a
contenção de todas as linhas desativada e 7,3 ms com a contenção seletiva.

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
