# Flyoff — Performance de notas grandes

> Referência técnica e operacional para manter o editor de Markdown fluido com
> documentos de 20 mil linhas sem perder fidelidade, seleção, IME, corretor,
> cores ou imagens.

Última atualização: virtualização também da view de leitura, em granularidade de
bloco, medida em uma fixture de 20.000 linhas e 1.208.000 caracteres. As tabelas
de source e de corretor abaixo continuam vindo da fixture anterior, de 15.000
linhas e 902.931 caracteres, e estão marcadas onde isso importa.

## Resumo executivo

O gargalo principal não era o parser Rust nem a atualização do modelo. Era
manter dezenas de milhares de elementos de Markdown simultaneamente no DOM do
Chromium. Mesmo sem crash, recálculo de estilo, layout, pintura, hit testing e
seleção faziam o editor se comportar como uma interface de 15–20 FPS.

O editor de source agora é uma implementação própria do Flyoff, sem Monaco ou
CodeMirror. O texto completo e seu estado ficam fora do DOM; a interface monta
somente a janela visível, com overscan e limite rígido de 300 linhas. Um
`textarea` oculto serve apenas como espelho de entrada e nunca recebe mais de
8.192 unidades de código UTF-16.

A view de leitura recebeu o mesmo tratamento, em granularidade de bloco. Uma
medição direta em 20 mil linhas mostrou onde estava o custo: construir os
29.163 elementos custava 141 ms, mas o layout do Blink sobre eles custava
477 ms na abertura e 34 ms em cada edição. Parsear apenas os 40 blocos de uma
janela custa 0,2 ms, contra 77 ms do documento inteiro. Montar uma tela em vez
do documento torna abertura, edição e scroll proporcionais ao viewport.

`content-visibility: auto` por bloco foi medido como alternativa e recusado com
número: melhora a abertura (477 ms para 97 ms), mas piora o scroll de 16,9 ms
para 64,1 ms de mediana e deixa a altura do documento instável (680.880 px para
624.252 px). Ele pula layout, mas os elementos continuam existindo e voltam a
ser medidos ao entrar no viewport.

O caminho de DOM completo continua atendendo notas pequenas, tanto no source
quanto na leitura, onde ele preserva as vantagens nativas do `contenteditable`,
da seleção e do localizar na página sem custo relevante. O corte é o mesmo dos
dois lados, `shouldWindowMarkdownSource`: 256 mil caracteres ou 2.000 linhas.
Para notas grandes, o caminho completo aparece no benchmark somente como
diagnóstico comparativo e não é usado como fallback.

## Arquitetura atual

O fluxo principal separa fonte, geometria, visualização e entrada:

```text
texto completo + modelo de linhas
              │
              ├── SourceHeightMap (Fenwick) ── viewport + scrollHeight
              │                                  │
              │                                  └── até 300 linhas no DOM
              │
              └── seleção global + caret próprios
                                  │
                                  └── mirror de entrada de até 8.192 code units
                                             │
                                             └── edição incremental do modelo
```

### Modelo fora do DOM

O texto completo, offsets, linhas e seleção global pertencem ao modelo do
editor. Os elementos visíveis são uma projeção descartável desse estado, não a
fonte de verdade. Desmontar uma linha fora do viewport não remove seu conteúdo
nem altera seleção, histórico ou clipboard.

Essa separação segue o princípio usado por editores de código grandes, mas a
implementação continua própria do Flyoff para preservar o Markdown visual,
cores, imagens e as integrações existentes.

### Geometria indexada

`SourceHeightMap` armazena as alturas das linhas em uma Fenwick tree. Consultas
de altura acumulada, offset de uma linha e linha correspondente a uma posição
vertical não exigem percorrer as 15 mil entradas.

As alturas conhecidas são atualizadas quando linhas visíveis são medidas.
Linhas ainda não medidas usam estimativas coerentes com seu tipo. Isso mantém a
barra de rolagem completa sem montar o documento completo.

### Viewport limitado

`sourceViewport` calcula o intervalo `[startLine, endLine)` a partir do scroll,
da altura do viewport e de overscan em pixels. `WindowedSourceView` monta apenas
esse intervalo e aplica um teto padrão de 300 linhas, inclusive em viewports ou
documentos adversariais.

Na rodada registrada de 15 mil linhas, foram montadas 45 linhas na abertura e
entre 44 e 61 durante a passagem de scroll. A contagem total após a rolagem
foi de 193 elementos descendentes, contra 62.966 no renderer legado.

O overscan cobre meia altura de viewport, com mínimo de 12 linhas para cada
lado. Medições DOM que refinam quebra de texto e altura ficam fora do caminho
de scroll contínuo e são consolidadas 80 ms depois que a rolagem para. Durante
o movimento, o mapa usa as estimativas já indexadas; isso evita um segundo
layout síncrono por frame sem alterar o `scrollHeight`.

### Janela da view de leitura

`WindowedMarkdownView` aplica o mesmo desenho em granularidade de bloco e
reaproveita `SourceHeightMap` e `sourceViewport`, que são indexados por posição
e não sabem se estão contando linhas ou blocos. O teto é de 120 blocos e o
overscan é meia altura de viewport, com mínimo de 480 px.

Os intervalos de bloco vêm de `splitMarkdownBlocks`, uma varredura de linhas.
O parse de Markdown de um bloco só acontece quando ele entra na janela. As
alturas partem de uma estimativa por tipo de bloco — heading, lista, tabela,
código, citação, imagem, parágrafo — sobre o número de linhas quebradas, e cada
medição real realimenta a altura por linha daquele tipo. Um bloco de imagem que
declara a própria altura é posicionado exatamente, sem estimativa.

Os offsets de bloco ficam em `Int32Array` paralelos ao array de fontes. Uma
edição contida em um bloco desloca os offsets seguintes com aritmética sobre
inteiros, em vez de realocar um objeto por bloco.

### Modelo preguiçoso do source

Virtualizar o DOM não adianta se o modelo continua fazendo trabalho de
documento inteiro. Três custos escondidos na montagem do modelo foram removidos:

O cache de linhas destacadas evicção-por-Map era quadrático. Ele pegava a chave
mais antiga com `lineCache.entries().next()`, e em V8 ler o primeiro item de um
Map que já sofreu remoções percorre as lápides até um rehash. Com uma linha
única por linha do documento, toda linha acima do limite de 16.384 pagava essa
caminhada: 11,8 ms em 15 mil linhas contra 232,5 ms em 20 mil, exatamente nos
dois lados do limite. Agora são duas gerações e a rotação é O(1).

O HTML de cada linha passou a ser preguiçoso. O modelo destacava a nota inteira
enquanto a view monta uma tela, gastando 6,5 µs por linha quase toda em linhas
que ninguém ia ver. Só as marcas que exigem varredura sequencial, porque uma
cerca de código carrega estado entre linhas, continuam eager.

A linha virou classe em vez de objeto literal. Acessores declarados em literal
são alocados por objeto: cada linha carregava duas funções novas. No prototype
não custam nada por linha, o que importa quando uma nota constrói dezenas de
milhares delas de uma vez. A contagem de grafemas saiu de um `WeakMap` para um
campo da própria linha, eliminando duas operações de hash por linha.

O efeito somado, em `createSourceDocumentModel`:

| linhas | antes | depois |
|---:|---:|---:|
| 5.000 | 5,4 ms | 1,2 ms |
| 20.000 | 236,5 ms | 6,3 ms |
| 40.000 | 488,7 ms | 12,4 ms |
| 80.000 | — | 19,9 ms |

### Mirror de entrada

O `textarea` oculto contém somente uma janela local próxima ao caret, limitada
por `SOURCE_INPUT_MIRROR_MAX_CODE_UNITS = 8_192`. O conteúdo do `textarea` não
pode ser usado como cópia do documento inteiro.

Offsets locais são convertidos para offsets globais antes de atualizar o
modelo. Em uma seleção maior que o mirror, como `Ctrl+A`, a seleção global
original permanece armazenada mesmo que o `textarea` precise apresentar apenas
um caret local. A primeira edição substitui o intervalo global correto.

O diff do mirror preserva limites de pares substitutos e de `CRLF`, evitando
corromper emoji, caracteres fora do BMP ou quebras de linha.

### Seleção, caret e teclado

Seleção e caret visuais são desenhados sobre as linhas montadas. O adaptador do
source converte pontos da tela, offsets globais e retângulos visíveis sem
depender de um `contenteditable` contendo a nota inteira.

Comandos globais, como selecionar tudo, início/fim do documento, copiar, colar,
undo e redo, operam sobre o modelo completo. A navegação não fica limitada ao
fragmento presente no mirror. Ao arrastar uma seleção para fora do viewport, um
único scheduler por frame continua o autoscroll e para imediatamente no
`mouseup`, no blur, ao voltar para dentro ou ao chegar ao limite do documento.

### IME e edição incremental

O pipeline de `beforeinput`, `input` e eventos de composição mantém suporte a
IME. Durante uma edição normal, o editor:

1. lê a pequena mutação do mirror;
2. converte o intervalo local para o modelo global;
3. atualiza somente o trecho e as linhas afetadas;
4. corrige os índices e alturas necessários;
5. reconcilia apenas a janela visível.

Uma atualização sem mudança evita reconstrução de linha e permanece próxima de
O(1). Edições comuns carregam o intervalo local conhecido para o diff do modelo
e para o histórico, e atualizam uma única altura via Fenwick em O(log N). O
diff e o histórico não varrem o texto completo; o caminho crítico também não
recalcula todas as alturas, não reparsa e não remonta as 15 mil linhas.

Nem toda edição traz esse hint. Colar, desfazer e refazer chegam sem pista do
caret e obrigam a comparar o documento inteiro. Essa comparação era feita
caractere a caractere e custava 4,7 ms em 20 mil linhas e 19,6 ms em 80 mil.
Comparando em blocos de 2.048 com igualdade nativa de string, e deixando a
varredura fina só para o bloco que difere, ela caiu para 0,31 ms e 1,23 ms.

| operação no modelo, 20 mil linhas | antes | depois |
|---|---:|---:|
| edição com hint do caret | 0,57 ms | 0,57 ms |
| edição sem hint (colar, undo, redo) | 4,73 ms | 0,31 ms |

Os offsets de linha e de grafema ficam em `Int32Array`. Uma tecla desloca todos
os offsets depois do caret, e copiar e reescrever dezenas de milhares de números
encaixotados duas vezes por tecla é bem mais caro que o mesmo trabalho sobre um
array tipado, onde a cópia é um memcpy e o laço não encaixota.

Se conteúdo, nota, projeto ou view mudam durante uma composição, a composição
é cancelada e o mirror é ressincronizado antes de aceitar outra tecla. Isso
impede que offsets pertencentes à versão anterior sejam aplicados à nova nota.

Colagens multilinha usam o payload `text/plain` normalizado como fonte
autoritativa e não constroem uma árvore duplicada de `text/html`. Quando uma
colagem faz a nota cruzar o limite de virtualização, o editor legado também não
materializa esse resultado: a seleção é preservada e o modelo é promovido
diretamente para a view virtualizada.

### Markdown, cores, imagens e corretor

Heading, ênfase, links, listas, tabelas, cores e hosts de imagem continuam
renderizados, mas somente nas linhas montadas. Mudanças de altura causadas por
quebra de texto ou imagem alimentam o mapa de alturas.

Em notas grandes, o corretor Flyoff revisa a janela visível com overscan. Os
sublinhados usam CSS Custom Highlight no Chromium; a rodada registrada criou
163 ranges e zero elementos de marcação no DOM. A revisão do documento inteiro
existe apenas como diagnóstico do benchmark.

## Resultados medidos

As medições abaixo são um snapshot de uma execução no Electron Chromium
offscreen do Windows, com viewport interno de 1.000 × 650 px e GPU desabilitada.
Tempos absolutos variam por máquina; regressões devem ser comparadas no mesmo
ambiente. As tabelas de source e de corretor são da fixture de 15 mil linhas; a
de leitura é da fixture de 20 mil.

“Frio” significa a primeira instanciação medida daquela view dentro do processo
do benchmark, não a inicialização completa do sistema operacional ou do
aplicativo. Os números aquecidos usam sete amostras e descartam as duas
primeiras.

### Source virtualizado contra renderer legado

| operação | source virtualizado | renderer legado |
|---|---:|---:|
| primeira abertura medida | 93,7 ms | 804,6 ms |
| abertura aquecida, mediana | 18,4 ms | 782,9 ms |
| edição incremental, mediana | 2,2 ms | 24,7 ms |
| edição incremental, p95 | 3,0 ms | 31,3 ms |
| scroll, mediana | 16,8 ms | 25,2 ms |
| scroll, p95 | 17,9 ms | 40,2 ms |
| scroll, máximo | 18,3 ms | 77,9 ms |
| elementos descendentes | 193 | 62.966 |

O tempo de edição virtualizada se dividiu assim:

| etapa | mediana |
|---|---:|
| mutação do mirror | 0,2 ms |
| leitura do mirror | 0,4 ms |
| atualização do source | 1,6 ms |
| layout forçado no caminho de entrada | 0,0 ms |

Outras interações medidas:

| operação | mediana | p95 |
|---|---:|---:|
| leitura do retângulo do caret | 0,0 ms | 0,2 ms |
| ida e volta de seleção | 1,5 ms | 1,6 ms |
| status da seleção extensa | 0,0 ms | 0,1 ms |
| atualização sem mudança | 0,0 ms | 0,1 ms |

### Escala do source por tamanho de nota

A abertura do source escalava mal porque o modelo era construído inteiro, com
os três custos descritos em *Modelo preguiçoso do source*. Depois de removê-los,
a abertura passou a crescer perto de linearmente:

| linhas | abertura antes | abertura depois |
|---:|---:|---:|
| 20.000 | 179,4 ms | 16,4 ms |
| 40.000 | 596,8 ms | 20,1 ms |

Oito vezes mais linhas custavam 24 vezes mais tempo. Esse teste de escala vale
como guardrail: dobrar o documento deve dobrar a abertura, não mais que isso.

A altura estimada começou e terminou em 353.680 px durante a passagem de
scroll. O refinamento das linhas visíveis acontece quando a rolagem fica ociosa,
fora do frame crítico. O guardrail E2E permite deriva máxima de 0,5%; o valor
precisa permanecer pequeno, estável e sem saltos perceptíveis.

### Referência externa: CodeMirror 6

Comparar o Flyoff só com o Flyoff de ontem diz se ele melhorou, não se ele está
bom. O benchmark carrega a mesma fixture no CodeMirror 6, com a mesma
metodologia — host de 1.000 × 650 px, `EditorView.lineWrapping` ligado para
igualar o comportamento de quebra, `markdown()` para ele também destacar.

O CodeMirror é `devDependency` **apenas do benchmark**. O aplicativo não o
importa e ele não entra em nenhum bundle distribuído. Está ali como régua.

| operação, 20 mil linhas | Flyoff source | CodeMirror 6 |
|---|---:|---:|
| primeira montagem medida | **22,8 ms** | 36,8 ms |
| abertura aquecida, mediana | 16,9 ms | 14,8 ms |
| edição, mediana | 3,8 ms | **1,1 ms** |
| edição, p95 | 7,3 ms | **1,8 ms** |
| scroll de roda, mediana | 16,9 ms | 16,9 ms |
| scroll de fling, mediana | 16,9 ms | 16,9 ms |
| elementos descendentes | 259 | **74** |

Leitura honesta: abertura e scroll estão em paridade, e a primeira montagem do
Flyoff é mais rápida. **A edição está cerca de 3,5× atrás.**

O diagnóstico dessa diferença é estrutural, não uma micro-otimização perdida.
O CodeMirror mantém a edição como escrita pura no DOM e empurra toda leitura de
geometria para uma fase de medição em `requestAnimationFrame` — é o que a
documentação deles descreve, e é por isso que uma tecla não força layout. Ele
pode fazer isso porque usa o caret **nativo** do `contenteditable`.

O Flyoff desenha o próprio caret, e para posicioná-lo precisa ler o retângulo de
um `Range` de forma síncrona, dentro do caminho da tecla. Essa leitura força um
flush de layout que o CodeMirror nunca paga. O caret próprio custa a diferença
de edição — e, como ele é dimensionado pela caixa de linha inteira em vez da
caixa do texto, também é o motivo de ele parecer mais alto que um caret nativo.
As duas coisas têm a mesma causa.

Fechar essa diferença significa ou voltar ao caret nativo, ou pintar o caret na
fase de medição do frame seguinte.

O segundo caminho foi adotado. Uma tecla passou a ser escrita pura: `setSource`
renderiza em modo `writeOnly`, que reconcilia linhas e altura mas não pinta
seleção, e agenda o frame seguinte para a leitura. Durante composição IME a
pintura continua síncrona, porque o `textarea` oculto precisa estar sob o caret
no mesmo frame ou a janela de candidatos aparece contra geometria velha.

O caret também deixou de ser desenhado com a altura da caixa de linha. Ele agora
cobre a caixa do texto — `font-size × 1,2`, centrado na linha — que é o que um
caret nativo faz. Um retângulo muito mais alto que a linha vem de um host de
imagem, e nesse caso a altura original é preservada para o caret acompanhar a
imagem; existe teste cobrindo os dois casos.

| edição, 20 mil linhas | antes | depois | CodeMirror 6 |
|---|---:|---:|---:|
| mediana | 3,8 ms | **2,8 ms** | 1,1 ms |

A diferença caiu de ~3,5× para ~2,2×. O que resta está em `setSource` fora da
pintura: cerca de 1,9 ms, contra 0,73 ms de JavaScript medido no profiler.

### Estado do E2E empacotado

Três execuções consecutivas depois dessas mudanças falham a asserção de scroll
`p95 < 25 ms`, marcando 28,8, 28,0 e 37,3 ms, uma delas com um long task de
57 ms. O registro anterior nesta mesma máquina era 19,8 ms.

Não atribua isso às mudanças sem verificar. O benchmark headless mediu scroll
idêntico antes e depois delas — roda 16,8 ms com p95 de 18,0 ms — e as
contagens do E2E que descrevem a virtualização não mudaram: 41 linhas montadas,
máximo de 56, altura estável em 350.447 px nos dois lados da passagem. Só o
tempo de frame difere, e o E2E monta a aplicação inteira com GPU, React,
corretor e observers, que o harness isola. A máquina onde isso foi medido estava
compilando e executando Electron sem parar por horas.

O que fazer: reexecutar o E2E com a máquina descansada antes de tratar como
regressão, e comparar com uma execução do mesmo commit sem carga.

### Scroll de fling contra scroll de roda

A passagem de scroll do benchmark percorre o documento inteiro em 120 frames.
Em 20 mil linhas isso dá cerca de 1.900 px por frame, muito além da janela
montada, então **todo frame remonta a janela inteira**. É um pior caso útil,
mas nenhuma roda ou trackpad produz esse movimento.

Uma segunda passagem, `wheelScroll`, rola 120 px por frame — cerca de um clique
de roda. A diferença é a resposta prática à pergunta "trava em máquina fraca":

| CPU | scroll de fling | scroll de roda |
|---|---:|---:|
| 1× | 16,9 ms | 16,8 ms |
| 6× | 62,6 ms | **16,8 ms**, p95 19,2 ms |

Com a CPU seis vezes mais lenta, ler e rolar a nota continua em 60 FPS. Só
arrastar a barra de rolagem de ponta a ponta chega perto de 16 FPS. Não confunda
um número com o outro ao avaliar regressão.

### Comportamento com CPU lenta

Varredura em uma nota de 20 mil linhas, com `FLYOFF_BENCHMARK_CPU_THROTTLE`.
O multiplicador é relativo à máquina que executa; 4× e 6× são os presets de
*mid-tier* e *low-end mobile* do DevTools.

| | abertura do source | edição do source | scroll de roda |
|---|---:|---:|---:|
| 1× antes → depois | 179,4 → 17,4 ms | 2,3 → 2,4 ms | — → 16,8 ms |
| 4× antes → depois | 909,9 → 71,6 ms | 14,2 → 15,0 ms | — |
| 6× antes → depois | 1567,9 → ~132 ms | 24,8 → ~24 ms | — → 16,8 ms |

Rodadas com throttle variam bastante; os números de 6× são a mediana de três
execuções, e uma delas isolada chegou a marcar 30,3 ms de edição. Não tire
conclusão de uma rodada só.

O que essa tabela mostra: **abertura foi resolvida, edição não**. Ler e rolar
uma nota de 20 mil linhas numa CPU seis vezes mais lenta continua fluido; abrir
custa cerca de 130 ms, aceitável; digitar custa cerca de 24 ms por tecla, o que
é perceptível.

O que saiu do caminho da tecla, medido com o profiler de CPU:

- a leitura de `scrollTop` depois de escrever o mirror de entrada, que forçava
  o Blink a recalcular layout no meio da edição;
- o `+=` sobre `scrollTop`, que lia a posição de volta uma segunda vez;
- a escrita da altura do canvas quando o valor não mudou.

Isso levou o JS por tecla para cerca de 0,73 ms. O que resta a 6× é layout e
pintura do Blink, não JavaScript, e não cede a micro-otimização — precisaria de
mudança estrutural no que a view escreve por edição.

Três tentativas foram revertidas. Vale registrar para ninguém repetir, porque as
três seguem o mesmo padrão: cache ou adiamento que parecia óbvio, **não mudou
nada de mensurável**, e custou correção.

1. Adiar a passagem de medição enquanto a digitação está em curso. Tirava ~50
   chamadas de `getBoundingClientRect` por tecla; a edição ficou em ~24 ms a 6×
   com e sem ela. Em troca deixava a geometria na estimativa por 120 ms, e é
   exatamente ela que dimensiona caret e seleção.
2. Cachear `clientHeight` para tirar a leitura do caminho da tecla. A edição
   mede 2,4 ms com e sem o cache. Em troca, um observer disparando no meio de
   uma animação de painel gravava uma altura de poucos pixels, e o guard só
   re-lia quando o valor era `<= 0`: um valor pequeno **travava**, e o viewport
   passava a montar duas linhas em vez de uma tela. Para quem usava, a nota
   parava de carregar para baixo.
3. Coalescer o rebuild do mapa por tempo e fixar a âncora de scroll a cada
   frame do resize. A fixação por frame sobrescrevia o scroll do usuário: rolar
   disparava um render, que restaurava a âncora, que disparava outro scroll —
   realimentação que travava o scroll rápido. E não podia funcionar de todo
   jeito, porque corrige `scrollTop` a partir do mapa, e é o mapa que está
   desatualizado durante a animação.

A lição comum: medir antes de aceitar o custo. Nenhuma das três apareceu no
benchmark, e todas apareceram para quem estava usando o aplicativo.

### Deslocamento de scroll ao dividir painel: causa raiz

`readLayoutSignature()` inclui `root.clientWidth` e `editor.clientWidth`, e a
animação do painel é uma transição de `grid-template-columns` de 120 ms. A
largura muda em todo frame, então a verificação de assinatura nunca
curto-circuita e `resetLayout()` roda cerca de sete vezes, uma por frame.

Cada execução re-ancorava com `Math.min(anchorWithin, heightAt(anchorLine))`.
Esse `Math.min` é **unidirecional**: quando a nova altura estimada da linha
ancorada é menor que o offset interno guardado, a diferença é perdida e nunca
volta. Como cada frame partia do `scrollTop` já reduzido pelo anterior, a perda
compunha monotonicamente **para cima** — medido em uso: linha 85 para 74 ao
abrir, e 84 para 83 ao fechar, com a magnitude acompanhando quanto a largura
mudou.

A âncora passou a ser `{ line, fraction }`, proporcional à altura da própria
linha, e é capturada **uma vez por transição** em vez de por frame: resets
consecutivos restauram sempre a partir do valor original.

O segundo mecanismo era o próprio view se confundindo com o usuário.
`handleScroll` ligava `this.scrolling` para qualquer evento de scroll, incluindo
as escritas programáticas do próprio `resetLayout` — então `this.scrolling` ficava
preso durante toda a animação e `shouldMeasure` era falso todo esse tempo, o que
suprimia justamente a passagem que reconcilia as linhas re-quebradas. Toda
escrita de scroll do view passa por `writeScrollTop`, que registra o valor
pretendido; o handler reconhece a própria escrita comparando com ele. O mesmo
sinal solta a âncora de transição assim que o scroll é de verdade do usuário.

Em `measureLines`, `setCanvasHeight` passou para **antes** da escrita de
`scrollTop`: uma escrita feita enquanto o canvas ainda tem a altura antiga é
clampada contra ela, e clamp só move para cima.

Uma terceira mudança foi tentada e **revertida pelo teste**, e vale registrar: a
compensação de `measureLines` somava `height - previousRenderedHeight`, e parecia
errado não usar `heightMap.heightAt(index)` (o valor que está sendo substituído
no mapa). É o contrário. `anchorAdjustment` compensa deslocamento **real de
pixels**, e só uma mudança de altura *renderizada* move pixels; corrigir a crença
do mapa sobre uma linha não move nada. Quando não há medição anterior, a altura
renderizada não mudou e não há o que compensar. O teste
`keeps the viewport fixed when deferred measurement settles` já cobria isso e
pegou o erro.

### Perda de scroll ao trocar de aba: causa raiz

`PageHost` esconde o painel inativo com `hidden`, e
`.page-panel[hidden] { display: none }`. `active` e `hidden` vêm da mesma
atualização de estado, então o React aplica `hidden` na fase de mutação **antes**
do `useLayoutEffect` do `MarkdownEditor` rodar. O ramo de desativação lia
`editor.scrollTop` nesse instante — de dentro de `display: none`, onde a leitura
retorna 0 — e reportava esse zero. A persistência não distingue relatório
provisório de assentado, então o zero sobrescrevia o valor bom.

A posição era destruída na **saída** da aba, não na volta. Agora a geometria só é
lida enquanto o elemento tem caixa; sem caixa não há nada novo a reportar, porque
o listener de scroll já persistiu a posição real enquanto a nota estava na tela.

### Corretor

| escopo | frio | aquecido | p95 aquecido | resultado |
|---|---:|---:|---:|---|
| janela visível | 110,9 ms | 12,9 ms | 13,3 ms | 46 linhas, 163 ranges, 0 marcadores DOM |
| documento inteiro | 130,4 ms | 119,2 ms | 128,6 ms | somente diagnóstico |

O aplicativo usa o escopo visível em notas grandes. O custo frio de ativação do
highlight não deve ser colocado no frame de entrada.

### Preview virtualizado

O preview passou a montar somente os blocos visíveis, com teto de 120 blocos.
`splitMarkdownBlocks` fornece os intervalos de bloco em uma varredura de linhas;
cada bloco só é parseado quando entra na janela. As alturas usam a mesma Fenwick
tree do source, com estimativa por tipo de bloco calibrada pelas medições reais
e altura exata para imagens que declaram a própria altura.

Âncoras de heading não podem ser derivadas da janela: o slug depende de todos os
headings anteriores do documento. `buildMarkdownHeadingIndex` resolve id e
caminho de heading para o documento inteiro sem renderizar, parseando apenas os
blocos que contêm `#`. Um heading montado recebe exatamente o id que receberia
em uma renderização completa.

Números na mesma fixture de 20 mil linhas, com o caminho de DOM completo medido
lado a lado como diagnóstico:

| operação | preview virtualizado | preview legado |
|---|---:|---:|
| primeira abertura medida | 52,8 ms | 564,9 ms |
| abertura aquecida, mediana | 29,7 ms | 689,7 ms |
| edição, mediana | 0,9 ms | 36,4 ms |
| edição, p95 | 1,0 ms | 42,7 ms |
| scroll, mediana / p95 / máximo | 16,6 / 17,7 / 18,4 ms | 21,1 / 40,5 / 108,5 ms |
| elementos descendentes | 55 | 29.162 |
| blocos montados | 22 de 12.198 | 12.198 |
| altura do documento | 696.949 px estimados | 680.887 px reais |

O caminho legado é bem mais sensível a carga da máquina que o virtualizado. Nas
rodadas registradas sua abertura variou de 526 a 690 ms e o máximo de scroll de
23 a 246 ms, enquanto o virtualizado se manteve entre 29 e 31 ms de abertura e
18,1 a 18,4 ms de máximo. Comparar apenas medianas de uma rodada esconde isso.

A altura do documento fica 2,4% acima da real e estável: não há salto de barra
de rolagem durante a passagem de scroll. A estimativa converge porque cada
medição realimenta a altura por linha daquele tipo de bloco e, quando o modelo
calibrado se afasta o bastante do que gerou as estimativas atuais, os blocos
ainda não medidos são reestimados com o anchor preservado.

Medir um bloco pelo próprio `getBoundingClientRect().height` subestimava o
documento em 28%: a caixa de borda não inclui as margens, e margens adjacentes
colapsam. A altura usada é a distância até o topo do bloco seguinte, que é o
espaço que o fluxo realmente dá ao bloco. O último bloco montado não tem sucessor
para medir e fica para uma passagem posterior.

A edição caiu para menos de 1 ms porque duas varreduras do documento saíram do
caminho crítico. `markdownTextChange` comparava caractere a caractere sobre
1,2 MB; passou a comparar em blocos de 2.048, deixando a varredura fina apenas
para o trecho que realmente difere. E uma edição contida em um bloco não
re-divide o documento: os três blocos ao redor do cursor são re-divididos e os
offsets seguintes são deslocados em arrays tipados, sem realocar 12 mil objetos.

Seleção e cópia mudam de contrato. Uma seleção do mouse dentro da janela montada
continua nativa. `Ctrl+A` não pode virar um range de DOM sobre o que não existe,
então ele marca a nota inteira como selecionada e a cópia serve o texto completo
do modelo, não o fragmento montado.

## Benchmark reproduzível

Para executar a fixture de 15 mil linhas no PowerShell:

```powershell
$env:FLYOFF_BENCHMARK_LINES='15000'
npm run benchmark:large-notes
```

Três variáveis controlam a execução:

| variável | efeito |
|---|---|
| `FLYOFF_BENCHMARK_LINES` | tamanho da fixture, em linhas |
| `FLYOFF_BENCHMARK_CPU_THROTTLE` | multiplicador de lentidão de CPU via CDP |
| `FLYOFF_BENCHMARK_SKIP_LEGACY` | `1` pula os diagnósticos de DOM completo |
| `FLYOFF_BENCHMARK_SKIP_REFERENCE` | `1` pula a régua do CodeMirror 6 |

O throttle usa `Emulation.setCPUThrottlingRate` pelo debugger do Electron. É o
controle certo para emular uma máquina fraca porque layout e style são trabalho
de CPU na thread principal; o harness já roda sem GPU. É um multiplicador sobre
a máquina que executa, não uma peça de hardware específica, e não emula disco
lento nem pouca memória.

Os caminhos legados custam minutos com a CPU estrangulada e existem só para
flagrar uma regressão de volta a eles, então convém pular com
`FLYOFF_BENCHMARK_SKIP_LEGACY=1` em qualquer varredura com throttle.

Para descobrir **onde** o tempo vai, e não só quanto, existe um profiler de CPU
que usa o `Profiler` do CDP e agrega self time por função:

```powershell
$env:FLYOFF_BENCHMARK_LINES='20000'
npx electron --no-sandbox --ozone-platform=headless --disable-gpu scripts/profile-source.cjs
```

Ele roda uma passagem de scroll e uma de edição sobre a view virtualizada de
source. Foi assim que o layout thrashing da edição apareceu: o custo migrava de
função em função conforme era corrigido, sempre parando na primeira que lia
geometria depois de uma escrita.

O benchmark valida:

- primeira montagem e montagens aquecidas de source, renderer legado e preview;
- edição incremental e divisão entre mutação, leitura, modelo e layout;
- integridade do texto completo após cada edição, não apenas do mirror;
- mirror de entrada com no máximo 8.192 unidades de código;
- caret, seleção, status e atualização sem mudança;
- linhas montadas, elementos descendentes e altura antes/depois do scroll;
- frame-time de uma passagem completa, com o índice do frame mais lento;
- blocos montados do preview contra o total de blocos do documento;
- spellcheck frio e aquecido, completo e limitado ao viewport.

`legacySource` e `legacyPreview` são executados nessa fixture apenas para expor
regressões que voltem a aproximar notas grandes do custo de DOM completo. Em
produção, os dois continuam sendo o caminho de notas pequenas.

O índice do frame mais lento importa na leitura do resultado. O máximo de scroll
cai quase sempre no frame 0, que é aquecimento, e varia bastante entre execuções;
mediana e p95 ficam presos ao frame de 60 Hz e são o número estável. Um máximo no
meio da passagem é que indica trabalho caindo no frame errado.

O harness desabilita GPU e não monta toda a aplicação React, observers,
persistência ou sincronização de modo dividido. Ele isola o renderer e o CSS,
mas não substitui o E2E empacotado nem o teste manual na nota real. JSDOM também
não substitui esse teste porque não calcula layout.

## E2E empacotado de 15 mil linhas

O teste `tests/e2e/large-markdown-performance.spec.ts` inicia o aplicativo
empacotado e cola uma fixture exata de 15 mil linhas e 1.168.916 caracteres,
com Markdown, cor e imagem. Depois salva, fecha e reabre a nota pelo
armazenamento real do projeto. Ele verifica:

- comprimento e contagem de linhas no modelo completo;
- heading, negrito, highlight colorido e host de imagem visíveis;
- mirror limitado a 8.192 unidades e no máximo 300 linhas montadas;
- menos de 3.000 elementos no editor virtualizado;
- colagem e reabertura completas abaixo de 2.000 ms;
- 180 frames de scroll, p95 abaixo de 25 ms, máximo abaixo de 50 ms e nenhum
  long task;
- deriva de altura abaixo de 0,5% e montagem da última linha;
- edição publicada no DOM em menos de 100 ms no fim do documento;
- conteúdo integral após editar, desfazer e refazer, validado por comprimento,
  início, fim e checksum da cópia via clipboard.

Em três execuções consecutivas no pacote Windows, a colagem ficou entre 305,1
e 339,7 ms, a reabertura entre 291,0 e 311,2 ms e a edição entre 20,7 e
22,6 ms. O scroll manteve p95 de 19,8 ms, máximo entre 21,1 e 21,7 ms, 56
linhas montadas e zero long task.

O E2E precisa rodar contra um ASAR reconstruído. Um pacote antigo pode produzir
um falso resultado sobre código que já mudou.

## Build e validação oficiais

Use o script oficial para compilar e executar as verificações:

```powershell
python scripts/rebuild.py --verify --strict
```

Para também gerar os distribuíveis:

```powershell
python scripts/rebuild.py --make --verify --strict
```

Depois do rebuild empacotado, execute o E2E específico:

```powershell
npm run test:e2e -- tests/e2e/large-markdown-performance.spec.ts
```

A ordem recomendada para uma alteração de performance é:

1. executar o build oficial com `--verify --strict`;
2. rodar o benchmark com `FLYOFF_BENCHMARK_LINES=15000`;
3. reconstruir o pacote com `--make`;
4. rodar o E2E empacotado;
5. validar manualmente a nota real.

## Verificação manual

Abra uma nota real de pelo menos 15 mil linhas e confira:

1. Edição, Dividido e Leitura, incluindo troca repetida de modo.
2. Scroll por roda, trackpad, Page Up/Down e arraste da scrollbar até o fim.
3. Digitação e deleção no início, meio e fim do documento.
4. Seleção longa, `Ctrl+A`, copiar/colar, undo e redo.
5. IME/composição, emoji e texto contendo `CRLF`.
6. Headings, listas, tabelas, links, cores e imagens `wrap`.
7. Corretor ligado, inclusive durante scroll e edição rápida.
8. Ausência de salto perceptível da barra de rolagem quando imagens ou linhas
   quebradas são medidas.

O benchmark desabilita GPU para reduzir variáveis do harness; isso não é uma
recomendação para o aplicativo. A aceleração de hardware deve continuar
habilitada na validação real.

## Invariantes e guardrails

- Não reintroduzir um `contenteditable` com uma árvore para todas as linhas.
- Não montar o documento de leitura inteiro no DOM. O custo dominante é layout,
  não parsing nem construção de nós, e ele volta inteiro junto com a árvore.
- Não usar `content-visibility` por linha ou por bloco como substituto da
  virtualização; os elementos ainda existiriam e headings, tabelas, texto
  quebrado e imagens continuariam corrigindo geometria. A medição registrada
  mostra melhora de abertura e regressão de scroll e de estabilidade de altura.
- Não derivar âncoras de heading da janela montada. Slug e caminho dependem de
  todos os headings anteriores e precisam de uma passagem sobre o documento.
- Não deixar uma varredura do texto completo no caminho de uma tecla. Comparar
  1,2 MB caractere a caractere já custava mais que todo o orçamento da edição.
- Não medir a altura de um bloco pela própria caixa de borda. Margens ficam de
  fora, margens adjacentes colapsam, e o documento inteiro sai subestimado.
- Não deixar o modelo fazer trabalho de documento inteiro só porque o DOM já
  está virtualizado. Destacar 20 mil linhas para mostrar 45 é o mesmo erro em
  outra camada.
- Não evictar de um `Map` pegando a chave mais antiga por iteração. Em V8 isso
  percorre as remoções anteriores e vira quadrático; rotacionar uma geração
  inteira é O(1).
- Não declarar getters em object literal para objetos criados aos milhares.
  Cada objeto ganha uma função nova; no prototype de uma classe elas são
  compartilhadas.
- Não ler geometria (`scrollTop`, `clientHeight`, `getBoundingClientRect`)
  depois de escrever no DOM dentro do caminho de uma tecla. Cada leitura força
  um flush de layout. Leia antes de escrever, ou use valor cacheado.
- Não ler geometria de um elemento em `display: none`. A leitura retorna 0 e, se
  esse 0 for persistido, destrói o estado do usuário.
- Âncora de scroll é proporcional à altura da linha e capturada **uma vez** por
  transição de layout. Recapturá-la de um `scrollTop` já corrigido faz o erro
  compor a cada frame.
- Escrita de scroll feita pelo próprio view não conta como scroll do usuário.
  Confundir os dois suprime a medição e cria realimentação com o reporter.
- Compensação de âncora se mede em pixels renderizados, não na crença do mapa de
  alturas. Só mudança de altura renderizada move conteúdo na tela.
- Escreva a altura do canvas **antes** de escrever `scrollTop`. O navegador
  clampa a escrita contra a altura vigente, e clamp só move para cima.
- Não avaliar scroll só pela passagem de fling. Ela remonta a janela inteira
  por frame e não corresponde a nenhum gesto real; `wheelScroll` é o número que
  representa leitura normal.
- Não confiar em uma medição repetida sobre o mesmo documento para estimar
  custo de abertura. Acima do limite do cache ela mede recomputação e abaixo
  mede acerto de cache, o que fabrica um degrau que não existe. Zere o cache
  entre amostras.
- Não confiar em uma única rodada do benchmark. O caminho de DOM completo varia
  muito mais com a carga da máquina que o virtualizado, e uma rodada sortuda dele
  pode parecer competitiva.
- Manter o modelo completo fora do DOM e nunca reconstruí-lo a partir do
  fragmento visível ou do mirror.
- Preservar seleção e caret em offsets globais. Uma seleção fora do mirror deve
  continuar sendo o intervalo editado, copiado e restaurado.
- Manter o teto de 300 linhas montadas e o mirror de 8.192 unidades, salvo
  mudança acompanhada de benchmark, E2E e justificativa.
- Atualizar texto, índices, alturas, Markdown, cores, imagens e spellcheck de
  forma incremental ou limitada ao viewport.
- Não mover parsing para o core nativo esperando corrigir layout e pintura do
  Blink. Trabalho fora do DOM só ajuda quando reduz o caminho crítico medido.
- Não aceitar uma mediana isolada. Comparar mediana, p95, máximo, DOM, linhas
  montadas, deriva de altura e integridade do documento na mesma máquina.

Áreas como acessibilidade, busca no documento e comportamento de plataforma
devem continuar cobertas explicitamente ao evoluir a virtualização; não se deve
presumir que o DOM completo era a única forma de implementá-las.

## Referências

- [Input Events Level 2](https://www.w3.org/TR/input-events-2/) para
  `beforeinput` e composição IME.
- [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API)
  para ranges visuais sem mutação do DOM.
