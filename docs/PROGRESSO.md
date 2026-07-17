# Flyoff — Progresso do desenvolvimento

> Documento de contexto/hand-off. Resume tudo que foi feito, as decisões
> tomadas, o que está pronto e o que falta. Escrito para ser lido por um
> humano **ou** por um assistente que vá continuar o trabalho em outra máquina.

Última atualização: propriedades seguras, caminho lógico completo e tooltip Flyoff corrigida.

---

## Atualização — propriedades e proteção de notas

- O cabeçalho da nota mostra o caminho lógico completo, sem extensão nem separadores dependentes do sistema operacional, e acompanha rename/move dos ancestrais carregados.
- Notas Markdown oferecem `Propriedades…` no menu e por `Alt+Enter`, com metadados, tamanhos, datas, política de somente leitura e estado de proteção.
- Somente leitura bloqueia edição e salvamento no renderer e no processo principal, inclusive em chamadas forjadas e saves forçados, sem alterar permissões físicas do arquivo.
- A proteção usa envelope binário autenticado v1, AES-256-GCM, DEK aleatória por nota e KEK derivada com `scrypt` (`N=131072`, `r=8`, `p=1`). Escritas permanecem atômicas e revisões continuam sendo SHA-256 dos bytes reais.
- Chaves ficam isoladas por janela, projeto e nota no processo principal. Lock, fechamento, troca de projeto, trash, destruição da janela e encerramento limpam as sessões correspondentes.
- Manifesto v2 e índice v3 adicionam a barreira de compatibilidade e `attributes.readOnly`; manifesto v1 e índices v1/v2 continuam legíveis e migram na primeira mutação.
- O fechamento de uma nota protegida congela mutações, faz flush, remove a chave e só então descarta texto/DOM/histórico. Se o flush ou lock falhar, o fechamento é cancelado.
- A tooltip do botão `+` permanece suprimida depois do clique até hover e foco realmente saírem; fechar o seletor fora não devolve foco nem reabre a tooltip.

---

## Atualização — interações e árvore

- Abas abrem e fecham em 90 ms, no fluxo, sem transparência e com a mesma curva `ease-out`; fechamentos consecutivos preservam a ordem visual.
- `TooltipHost` autoral substitui os tooltips nativos do renderer. Ele diferencia hover, foco e transferência de ponteiro, fecha em ações ou mudanças de contexto e restaura `aria-describedby` sem deixar estado preso.
- A toolbar Markdown usa somente ícones acessíveis, com `aria-label` e tooltip Flyoff.
- A árvore não exibe loading transitório ao expandir pastas. Filhos entram atomicamente; pastas vazias permanecem vazias e erros mantêm retry.
- Duplo clique não renomeia mais itens. Renomear continua disponível por `F2` e pelo menu contextual.
- O menu de área vazia atua sobre o ramo clicado e oferece nova instância, nova pasta, expandir/colapsar tudo, revelar no gerenciador de arquivos e copiar caminho.
- Expansão recursiva usa até quatro leituras simultâneas e para com segurança em 500 pastas, mantendo o resultado parcial.
- Caminhos são resolvidos no processo principal; revelar e copiar passam por validação de sender e payload antes de usar APIs nativas.
- `AGENTS.md` registra os limites globais de resposta, animação, ausência de flick e uso obrigatório da tooltip Flyoff em controles somente com ícone.

---

## 1. O que é o Flyoff

Aplicativo de notas de desktop (estilo Basalt/Obsidian, porém mais completo e
escalável). Interface em **modo escuro** com destaque **roxo**. Filosofia de UI:
simples, direta, sem excesso de animação (ver `AGENTS.md`).

**Stack:**
- **Electron 43** + **React 19** + **TypeScript** (Electron Forge + Webpack).
- **Node 24.18**.
- **`packages/native-core`**: addon **C++ (N-API / C++20)** compilado por `node-gyp`.
- Testes: **Vitest** (unit, jsdom) + **Playwright** (e2e).
- i18n próprio (pt-BR / en-US) em `src/shared/i18n/catalogs.ts` (catálogo tipado).

**Processos (Electron):**
- `src/main/` — processo principal (janela, IPC, projetos, sessão, segurança).
- `src/preload/` — ponte segura (`contextBridge`) expondo `window.flyoff` (`FlyoffApi`).
- `src/renderer/` — UI React.
- `src/shared/contracts/` — tipos + validadores compartilhados (a "fonte da verdade").

---

## 2. As 14 solicitações originais

1. Reabrir a tela inicial do projeto clicando no nome do projeto.
2. Fechar todas as abas num projeto **não** deve fechar o projeto nem voltar pro Início — deve ficar um estado "nenhuma aba aberta" + botão "Fechar projeto".
3. Botão direito nos itens da árvore deve abrir o **mesmo** menu do `•••`.
4. Ícones fornecidos como **SVG** (não desenhados no código).
5. Nota deve se comportar como nota: divisão de linhas, **markdown preview em tempo real**, virtualização, otimização.
6. **Duas sidebars** à esquerda no projeto: rail (Projeto/Grafo/Mídia/Configurações) + árvore.
7. Opção de **preview** por `.md`.
8. **Engine de markdown próprio**, preciso e otimizado, com módulos, cores e imagens.
9. **Barra de ferramentas** de markdown.
10. Ao abrir um projeto, abas de Início/Configurações **somem** (igual VS Code).
11. Botão no cabeçalho da janela pra **expandir/recolher** a sidebar esquerda.
12. Sidebar(s) **redimensionáveis** com o mouse (estilo Obsidian).
13. Barra de ferramentas/painéis também redimensionáveis.
14. Bug visual: chevron `^`/`>` da pasta desalinhado quando aberto.

---

## 3. Decisões tomadas (com o Gabriel)

- **Sessão (itens 1/2/10):** modelo **workspace por projeto** (estilo VS Code) — Home e cada projeto são workspaces de abas separados.
- **Editor (itens 5/8):** **custom**, sem CodeMirror (experiência ruim anterior). Engine de markdown **próprio**. **Live Preview inline (WYSIWYG) por último**, como módulo separado.
- **Preview (item 7):** os **três** modos — Edição (fonte), Leitura, Split. WYSIWYG adiado.
- **Sem novas dependências de runtime** em nenhum lote.
- **Ordem dos lotes** definida pelo assistente (abaixo).

---

## 4. Organização em lotes e status

| Lote | Conteúdo | Itens | Status |
|------|----------|-------|--------|
| **1** | Correções + polish (chevron, menu direito, toggle, resize) | 3, 11, 12, 13, 14 | ✅ **Concluído** |
| **2** | Workspace por projeto | 1, 2, 10 | ✅ **Concluído** |
| **3** | Sidebar dupla / rail no projeto | 6 | ⏳ Aguardando ícones `rail/` |
| **4** | Editor + engine de markdown | 5, 7, 8, 9 | ⏳ Pendente (terá desenho próprio) |

Plano completo original: `~/.claude/plans/bele-perfeito-precisamos-fazer-unified-adleman.md` (fora do repo).

---

## 5. Lote 1 — Correções + polish ✅

### 1.1 Bug do chevron (item 14)
**Causa:** o código trocava **dois glifos Unicode diferentes** (`⌄` U+2304 aberto / `›` U+203A fechado) com métricas distintas → o aberto "caía".
**Correção:** um **glifo único** girado 90° por CSS (`transform: rotate(90deg)` no estado expandido), transição removida em `prefers-reduced-motion`. Helper `ProjectTreeChevron`.
- Arquivos: `src/renderer/projects/ProjectTree.tsx`, `projects.css`.

### 1.2 Menu de botão direito (item 3)
Novo componente **`ContextMenu`** reutilizável que reaproveita 100% o `MenuTree` posicionando-o num ponto (âncora virtual 0×0 no clique). O `MenuTree` ganhou `ariaLabel` opcional (menu de contexto não tem trigger pra rotular). Botão direito em qualquer nó abre os **mesmos** `items`/`onAction` do `•••`. Continua independente de Electron/IPC.
- Arquivos: `src/renderer/components/menu/ContextMenu.tsx` (novo), `MenuTree.tsx`, `menu/index.ts`, `ProjectTree.tsx`.

### 1.3 Redimensionamento + toggle (itens 11, 12, 13)
- **Toggle no titlebar** entre "Flyoff" e "Arquivo", `-webkit-app-region: no-drag`, renderiza também no macOS.
- **Sidebar redimensionável** com o mouse: `usePanelResize` (pointer-driven, `pointermove` global, sem lag) + `PanelResizer` (`role="separator"`, teclado Arrow/Home/End, double-click reseta). A largura é escrita ao vivo na CSS var `--sidebar-width`; durante o arrasto uma classe global `flyoff-resizing` suprime transições.
- **Persistência fora do `tab-session.json`** (regra do AGENTS): novo store de UI espelhando `window-state-store`.
  - `src/shared/contracts/ui-state.ts` — `WorkspaceLayoutState` (`sidebarCollapsed`, `sidebarWidth`, `railViewId`) + `normalize`/guard, min/max/default.
  - `src/main/window/ui-state-store.ts` — grava `ui-state.json` (atômico).
  - `src/main/ipc/ui-state.ts` — handlers `get`/`save` validados (`validateTrustedMainFrame`).
  - Preload: `getUiState`/`saveUiState`. Hook renderer: `useWorkspaceLayout` (load + persist debounced 200 ms).
- Correção extra reportada: sidebar colapsada vazava conteúdo → `overflow: hidden` no `.home__sidebar`.
- Arquivos novos: `src/renderer/components/layout/{usePanelResize.ts, PanelResizer.tsx, useWorkspaceLayout.ts, layout.css, index.ts}`. Alterados: `App.tsx`, `styles.css`, contratos, main, preload, i18n.

---

## 6. Lote 2 — Workspace por projeto ✅

### Modelo mental
Existe exatamente **um projeto ativo por janela** (o processo principal já assume isso). Então há **dois contextos**:
- **Home** — sempre presente, mantém a invariante "**Início obrigatória** quando a lista de abas esvazia".
- **Projeto aberto** — pode ficar **vazio** (zero abas) e **nunca** semeia um tab de Início.

O contexto ativo é **derivado**: se há projeto aberto, você está nele; senão, na Home. (Não existe estado "Home visível com projeto aberto em segundo plano".)

### Reducer
- `src/renderer/components/tabs/tab-state.ts` — **intacto**; continua sendo o reducer da **Home** (preserva singleton, Início-obrigatória, seleção da aba vizinha). Só passou a **exportar** `createDescriptor`.
- `src/renderer/components/tabs/workspace-state.ts` (**novo**) — container acima do reducer:
  - `WorkspaceState { home: TabState; project: ProjectWorkspaceState | null }`.
  - `projectTabReducer` — igual ao `tabReducer` **exceto** que fechar a última aba → `{ tabs: [], activeTabId: null }` (sem semear Home) e ignora targets internos/de outro projeto.
  - `workspaceReducer` — roteia cada `TabAction` pro contexto ativo + ações novas: `open-project-workspace`, `close-project-workspace`, `restore-workspace`.
  - Seletores: `selectActiveContext`, `selectActiveTabs`, `hasRestorableWorkspace`, `serializeWorkspace`, `adoptWorkspaceSnapshot`.

### Persistência + migração (v3)
- `src/shared/contracts/tab-session.ts`:
  - `TAB_SESSION_VERSION = 2` (inalterado; é a versão do snapshot **interno** da Home).
  - Novo `WORKSPACE_SESSION_VERSION = 3` e `WorkspaceSessionSnapshot { version: 3; home: TabSessionSnapshot; project: { projectId; tabs; activeTabId } | null }`.
  - `normalizeWorkspaceSessionSnapshot` — aceita v3 **e migra** um snapshot plano v1/v2 (divide por `isProjectTarget`: tabs internos → `home`; tabs de projeto → `project`; se sobrar só projeto, semeia uma aba de Início na Home).
  - `isWorkspaceSessionSnapshot` (guard estrito pra IPC), `hasRestorableWorkspaceSnapshot`.
  - **`active` não é persistido** — é derivado de `project !== null` (evita estados impossíveis).
- Propagado o tipo em: `close.ts` (`CloseResponse.session`), `bootstrap.ts` (`FlyoffApi`), `main/session/tab-session-store.ts`, `main/ipc/tab-session.ts`, `preload/index.ts`, `close-coordinator.ts` (sem mudança de código, só tipo).

### App.tsx — as mudanças-chave
- Reducer trocado: `tabState`/`dispatchTabs` → `workspaceState`/`dispatchWorkspace`; ref `workspaceStateRef`.
- **Removido o teardown acoplado ao fechar aba** (`closesProjectContext`) em `performGuardedTabAction` e em `commitProjectNodeTrashed` — fechar abas nunca mais chama `closeProject()`/`setActiveProject(null)`.
- `activateProject` → despacha `open-project-workspace`.
- Novo **`closeProjectWorkspace`** (o "Fechar projeto"): passa pela fila serializada `enqueueWorkspaceTransition`, faz flush dos documentos, despacha `close-project-workspace`, chama `getApi().closeProject()` e `setActiveProject(null)`.
- `commitProjectNodeTrashed` fecha apenas as abas de conteúdo removidas, despachando **direto** no reducer (bypassa o guard de close-request, senão a aba não fecharia com um fechamento de janela pendente).
- Shell: `GlobalSidebar` `hidden` quando contexto = projeto; `ProjectSidebar` só no contexto de projeto; `TabBar`/`PageHost` usam `selectActiveTabs`.
- Estado vazio via prop `emptyState` no `PageHost` (condição de **workspace**, não condicional de página).

### Estado vazio (item 2)
- `src/renderer/projects/ProjectEmptyState.tsx` (**novo**) — mensagem "Nenhuma aba aberta." + botão **"Fechar projeto"**. CSS `.project-empty` em `projects.css`.
- `PageHost` ganhou `activeTabId: string | null` e prop `emptyState?: ReactNode` (renderizada quando não há abas retidas). `TabBar` também aceita `activeTabId` nulo.

### "Fechar projeto" (item 1 + 2)
- O botão "←" da `ProjectSidebar` virou **`onCloseProject`** (label "Fechar projeto"). O botão do estado vazio chama o mesmo handler.
- Clicar no **nome do projeto** (`onOpenOverview`) reabre a visão geral (não destrói mais o contexto).

### Testes
- Novos: `tests/unit/workspace-state.test.ts` (7), casos de workspace em `tab-session-contracts.test.ts` (migração v1/v2→v3, projeto vazio, guards).
- Atualizados pro modelo novo: `tab-session-store`, `tab-session-ipc`, `close-coordinator`, `tab-workspace`, `project-app` (vários reescritos porque o comportamento mudou de propósito — ex.: trash que esvazia o projeto **não** fecha o projeto).

---

## 7. Ícones necessários (para o Gabriel fornecer)

**Specs:** SVG monocromático, `viewBox="0 0 24 24"`, **uma cor só** (é ignorada — o app pinta com `currentColor` via máscara CSS; toda área não-transparente vira a cor). `fill` ou `stroke`, sem gradiente/múltiplas cores. **kebab-case**, em `public/images/icons/<grupo>/`.

**🔴 Lote 3 (necessário) — `rail/`:** `project.svg`, `graph.svg`, `media.svg` *(Configurações reaproveita `homepage/configuration.svg`)*.

**🟠 Substituem o que hoje é código/CSS (têm fallback) — `tree/`:** `note.svg`, `folder.svg`, `folder-open.svg`, `chevron.svg`, `ellipsis.svg`, `file.svg`, `image.svg`, `pdf.svg`. **`chrome/`:** `sidebar-toggle.svg`.

**🟡 Lote 4 — `toolbar/`:** `bold`, `italic`, `strikethrough`, `heading`, `list-bullet`, `list-ordered`, `checklist`, `quote`, `code`, `code-block`, `link`, `image`, `table`, `divider`, `text-color`, `highlight`, `preview`.

**⚪ Opcional — `sidebar/`:** `arrow-left.svg`, `refresh.svg`, `plus.svg` (hoje são glifos `←↻+`).

Sistema de ícones: `src/renderer/components/MaskedIcon.tsx` (máscara CSS `currentColor`).

---

## 8. Build & Release (Windows)

**Por que não dá cross-compile local:** o `native-core` é um addon C++ compilado por `node-gyp` por plataforma; `node-gyp` **não** cross-compila Linux→Windows. Buildar no Windows é o único caminho confiável.

**Como funciona:** workflow `.github/workflows/build-windows.yml` roda em **`windows-2022`** (o `windows-2025` tem VS 18, que o `@electron/node-gyp` do Forge ainda não reconhece), faz `npm run make` e **publica** o instalador Squirrel + zip portátil num **GitHub Release** com tag `windows-build` (a cota de artefatos do Actions estava estourada; Release não conta nessa cota).

**Dispara em:** push na branch `build/windows-installer` **ou** manualmente (Actions → "Build Windows" → Run workflow).

**Download (sempre o mesmo link, sobrescrito a cada build):**
`https://github.com/adeondev/flyoff/releases/tag/windows-build`
- Instalador: `Flyoff-0.1.0.Setup.exe`
- Portátil: `Flyoff-win32-x64-0.1.0.zip`

> ⚠️ O workflow **"CI"** (padrão do repo) ainda roda no `windows-2025` e **falha** por esse mesmo bug do VS 18 — é pré-existente, **não** tem a ver com os lotes. Correção pendente (trocar `windows-2025`→`windows-2022` em `.github/workflows/ci.yml`), não aplicada por não ter sido autorizada.

---

## 9. Como verificar

```bash
npm install
npm run verify      # lint + typecheck + vitest + test:native  (tudo verde no Lote 2: 186 testes)
npm start           # abre o app (precisa de display; no codespace headless não roda)
```

**Testes manuais do Lote 2 (no build de Windows):**
1. Abrir um projeto → abas de Início/Configurações somem.
2. Fechar todas as abas → estado "Nenhuma aba aberta" + "Fechar projeto"; projeto continua aberto.
3. Clicar no nome do projeto → reabre a visão geral.
4. "Fechar projeto" → volta pra Home com as abas de Home preservadas.
5. Mandar nota aberta pra lixeira até esvaziar → não fecha o projeto (mostra estado vazio).
6. Fechar/reabrir o app com projeto aberto → restaura.

**Testes manuais do Lote 1:** chevron alinhado; botão direito = `•••`; sidebar redimensiona (double-click reseta); toggle no titlebar colapsa/expande; largura persiste ao relançar (grava em `ui-state.json`, não em `tab-session.json`).

> Nota: a sessão migrou pra **v3**. A migração é **one-way** — um build novo lê a sessão antiga e converte; um build **antigo** lendo a nova ignora e começa limpo (sem crash, mas perde as abas daquela sessão).

---

## 10. Git

- Branch de trabalho: **`build/windows-installer`** (contém tudo).
- Commits principais:
  - `feat: sidebar toggle, resize, right-click menu, chevron fix` — Lote 1.
  - `fix: clip sidebar content when collapsed` — correção do collapse.
  - `feat: workspace-per-project session model` — Lote 2.
  - `fix: style the empty project workspace state` — CSS do estado vazio.
  - (+ commits de build: `windows-2022`, `authors` do Squirrel, entrega via Release.)
- Também há mudanças pré-existentes não relacionadas na árvore (landing page, `AGENTS.md`, `.codex/`, `.hallmark/`, imagens de website) — **fora** dos commits dos lotes.

---

## 11. Próximos passos

- **Lote 3 (rail):** grid de 3 colunas no projeto (`rail | árvore | página`), registry data-driven de views (`projeto|grafo|midia|configuracoes`), componente `IconRail` (reusa `MaskedIcon`), reusa o resize do Lote 1. **Depende dos 3 ícones da `rail/`.** "Configurações" do rail é escopo de projeto (distinta da página interna de Settings da Home).
- **Lote 4 (editor/markdown):** engine próprio (pacote `packages/markdown`, TS: tokenizer → AST → renderers seguros, cores/imagens), editor de fonte custom (textarea transparente sobre `<pre>` realçado + gutter de linhas), 3 modos (Edição/Leitura/Split; WYSIWYG por último), toolbar. Modo de preview por `.md` persistido em `pageState.data`. **Terá desenho detalhado próprio antes de codar.**

---

## 12. Convenções do projeto (resumo do AGENTS.md)

- Mutação de abas **só** pelo reducer central; nada de condicional de página no shell/sidebar/tabbar.
- Estado restaurável = JSON pequeno, tipado, versionado; **nunca** conteúdo pesado no `tab-session.json`.
- Menus só via `src/renderer/components/menu/`, independentes de Electron/IPC.
- Paleta em `src/renderer/theme.css` (roxo + dark). Sem cores isoladas.
- Animações mínimas (abas ≤120 ms, opacidade ≤45 ms), removidas em `prefers-reduced-motion`.
- Compatibilidade **Windows/macOS/Linux** obrigatória.
- Comentários (quando essenciais) em inglês; sem comentários explicando modificações.
