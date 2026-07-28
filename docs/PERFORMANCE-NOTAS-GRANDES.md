# Flyoff — Performance de notas grandes

> Contexto técnico para manter o editor fluido sem comprometer seleção,
> navegação, corretor ou fidelidade do Markdown.

Última atualização: medição de frame-time no aplicativo empacotado, remoção de
layout tardio durante a rolagem e benchmark de estabilidade geométrica.

## Sintoma e causa

A nota usada para investigar o problema tem 100.963 bytes e 1.766 linhas. O
editor gera 7.738 descendentes no DOM; a leitura gera 1.516. O sintoma não era
tempo de abertura ou crash, mas rolagem e animações próximas de 15–30 FPS.

O parse de Markdown isolado fica perto de 10 ms nessa escala. Rust ou outro
parser nativo não resolveria o gargalo principal, porque o custo observado
estava no layout e na pintura do DOM pelo Blink.

O editor usava `content-visibility: auto` por linha, com uma altura intrínseca
de uma linha. A leitura aplicava a mesma estratégia por bloco. A estimativa era
incorreta para headings, tabelas, listas e texto quebrado:

| superfície | altura estimada | altura real | diferença |
|---|---:|---:|---:|
| edição | 41.600 px | 53.187 px | +27,9% |
| leitura | 31.948 px | 49.879 px | +56,1% |

Ao rolar, o Chromium ativava os elementos, descobria suas alturas e corrigia a
geometria do documento. Esse trabalho acontecia dentro dos frames e também
alterava a posição relativa da barra de rolagem.

Medição no aplicativo empacotado, com a nota real:

| rolagem do editor | mediana | p95 | máximo |
|---|---:|---:|---:|
| layout tardio por linha | 31,0 ms | 63,3 ms | 186,1 ms |
| layout estável | 16,7 ms | 21,6 ms | 58,7 ms |

Uma passagem mais agressiva pelo documento caiu de 42,0 ms de mediana e
87,2 ms de p95 para 17,0 ms e 46,2 ms. A leitura já era menos custosa, mas seu
p95 caiu de 27,6 ms para 20,7 ms e a altura deixou de mudar durante o scroll.

`contain: paint` também foi medido. Não trouxe ganho relevante e poderia cortar
conteúdo que escapa visualmente de um bloco, portanto não foi adotado.

## Estratégia atual

O documento permanece inteiro no DOM e com layout estável. Isso preserva
`contenteditable`, cursor, seleção, find-in-page, copiar/colar e a geometria
correta da barra de rolagem.

As otimizações mantidas são:

- reconciliação incremental do source, preservando linhas que não mudaram;
- parse e DOM incrementais na leitura, preservando blocos intactos;
- preview de notas grandes atualizado com debounce;
- spellcheck de notas grandes limitado à janela visível mais 120 linhas de
  margem em cada direção;
- cache de palavras do corretor reaproveitado entre janelas;
- classificação como nota grande a partir de 64 mil caracteres ou 1.000
  linhas.

As classes e a varredura que existiam apenas para excluir imagens e floats da
contenção foram removidas junto com a estratégia. Imagens `wrap` continuam
usando seu float normal e headings continuam aplicando `clear`.

O custo de abertura pode ser maior do que com layout tardio, mas acontece uma
vez. Transferir esse custo para cada frame de rolagem produzia uma experiência
pior e imprevisível.

## Benchmark reproduzível

`npm run benchmark:large-notes` executa Chromium offscreen com:

- viewport interno de 1.000 × 650 px;
- fixture de 1.766 linhas e aproximadamente 100 mil caracteres;
- hierarquia real de `.markdown-editor`;
- abertura e edição incremental de source e leitura;
- spellcheck completo comparado à janela visível;
- frame-time durante uma passagem completa pelo documento;
- altura antes e depois da rolagem.

O benchmark exige `heightChangePx: 0` como evidência de geometria estável. Os
percentis de frame são dados de diagnóstico: valores absolutos variam por
hardware e virtualização, portanto regressões devem ser comparadas no mesmo
ambiente.

Resultado depois da correção, no Chromium offscreen do Codespace:

| cenário | mediana | p95 |
|---|---:|---:|
| abertura do source | 87,7 ms | 117,9 ms |
| edição central no source | 3,1 ms | 3,6 ms |
| scroll do source | 16,7 ms | 17,0 ms |
| abertura da leitura | 59,7 ms | 94,5 ms |
| edição central na leitura | 4,8 ms | 6,3 ms |
| scroll da leitura | 16,7 ms | 17,7 ms |

Source e leitura terminaram a passagem com `heightChangePx: 0`. O spellcheck
completo custou 221,1 ms e criou 6.002 marcadores; a janela visível custou
21,5 ms e criou 947, mantendo a redução de aproximadamente 10 vezes.

O teste E2E do editor também verifica:

- `content-visibility: visible` em edição e leitura;
- `scrollHeight` inalterado durante a passagem;
- p95 abaixo de 50 ms e nenhum frame acima de 100 ms no cenário empacotado.

## Como verificar

1. Execute `npm run verify`.
2. Execute `env -u ELECTRON_RUN_AS_NODE npm run benchmark:large-notes`.
3. Empacote o aplicativo e execute o E2E do editor.
4. Abra a nota de 1.766 linhas em edição, leitura e modo dividido.
5. Teste roda, trackpad, Page Up/Down, seleção longa, busca, digitação e troca
   de modo.

O benchmark precisa rodar em Chromium real. JSDOM não calcula layout e não
representa este problema.

## Restrições

- Não virtualizar linhas sem uma solução explícita para seleção, caret,
  find-in-page e cópia do documento inteiro.
- Não reintroduzir altura estimada por linha ou bloco sem medir frame-time,
  estabilidade do `scrollHeight` e comportamento da barra de rolagem.
- Não mover parse para o core nativo esperando corrigir layout do Blink.
- Não aplicar contenção que crie um contexto incompatível com imagens `wrap`.
- Não usar um limite absoluto de FPS isoladamente para comparar máquinas
  diferentes.

## Referências

- [Input Events Level 2](https://www.w3.org/TR/input-events-2/) para
  `beforeinput` e composição IME.
- [CSS Containment Module Level 2](https://www.w3.org/TR/css-contain-2/) para os
  efeitos de contenção e `content-visibility`.
