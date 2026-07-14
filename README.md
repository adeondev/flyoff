# Flyoff

Flyoff é a fundação multiplataforma de um aplicativo privado e extensível de
notas. Esta etapa entrega a casca do desktop, navegação interna por abas,
restauração da sessão, menus Flyoff, localização, ponte segura e o núcleo C++
isolado. Editor, notas, cofres, persistência de documentos e o gerenciador visual
de dicionários ainda não fazem parte do projeto.

## Tecnologias e arquitetura

- Electron `43.1.0`, Node.js `24.18.0` e Electron Forge `7.11.2` com Webpack.
- React e TypeScript no renderer.
- Node-API e C++20 em `packages/native-core`, carregados por um
  `utilityProcess` separado.
- Interface em `pt-BR` ou `en-US`, escolhida pelo idioma do sistema, com
  `pt-BR` como fallback.
- Corretor Hunspell do Chromium no Windows/Linux e corretor nativo no macOS.

```text
src/
  main/       Electron, janela, menus, IPC, segurança e serviços
  preload/    única ponte tipada exposta ao renderer
  renderer/   shell React, páginas, abas e tema
  shared/     contratos e catálogos compartilhados
  utility/    processo isolado que carrega o addon
packages/
  native-core/  workspace Node-API + C++20
resources/    ícones de empacotamento
tests/        testes unitários, Electron e smoke do pacote
```

O renderer não possui acesso a Node.js, filesystem ou Electron. A ponte expõe
somente contratos validados para o estado inicial, comandos de menu conhecidos,
sessão de páginas, confirmação de encerramento e controles da janela.

A janela não utiliza moldura ou botões do sistema. Minimizar,
maximizar/restaurar e fechar são controles do Flyoff em todas as plataformas e
executam somente ações tipadas no processo principal. No Windows e Linux, a
marca e os menus ficam na mesma faixa dos controles. No macOS, os controles
também são do Flyoff e o menu do aplicativo continua global.

O Flyoff salva a posição, o tamanho normal e os estados maximizado/minimizado
em `window-state.json` no diretório de dados do usuário. Ao reabrir, os limites
são ajustados para uma tela disponível antes de serem aplicados. A paleta do
renderer fica centralizada em `src/renderer/theme.css`.

## Menus reutilizáveis

Os dropdowns do Flyoff são componentes React em
`src/renderer/components/menu/`, independentes da barra superior e sem acesso a
Electron. `DropdownMenu` atende qualquer gatilho da interface e `MenuBar` atende
barras horizontais. Ambos recebem itens tipados (`action`, `separator` ou
`submenu`) e um callback local para ações; eles não recebem objetos Electron,
coordenadas de janela ou permissões privilegiadas.

Os painéis usam portal, posicionamento fixo, inversão nas bordas da viewport e
a mesma superfície da barra superior. A única transição permitida é a opacidade
de 45 ms, automaticamente removida para `prefers-reduced-motion`. No Windows e
Linux, os menus Arquivo/Editar/Exibir/Ajuda da barra usam esse componente; no
macOS, o menu global nativo é preservado.

O renderer executa ações de aplicativo apenas por
`window.flyoff.executeMenuCommand(command)`. O comando é um ID de allowlist
validado pelo preload e pelo processo principal; este é o único lugar que pode
agir sobre janela, `webContents` ou aplicativo. `Menu.popup` não deve ser usado
para menus desenhados pelo Flyoff.

## Páginas, abas e sessão

As páginas internas são registradas em `src/renderer/pages/`. Cada definição
fornece identidade estável, tradução, ícone, componente, política de retenção e
um adaptador versionado para o pequeno estado que pode ser restaurado. A sidebar
e a barra **Páginas** usam o mesmo registry; uma nova página não deve ser ligada
diretamente ao shell por condicionais isoladas.

Para registrar uma página, adicione seu ID ao contrato compartilhado e às chaves
de tradução, implemente um componente com `InternalPageProps` e inclua uma única
definição em `page-registry.ts`. A definição decide se a página é singleton, o
estado inicial e `migrateState`; `PAGE_NAVIGATION_ORDER` decide sua posição na
sidebar. Ao mudar o formato restaurável, incremente `stateVersion` e faça a
migração aceitar versões anteriores; se um estado não puder ser migrado, retorne
apenas o padrão daquela página.

O estado das abas é centralizado em um reducer independente da interface. Ele
garante páginas singleton, ordem estável, seleção da aba vizinha ao fechar e a
reabertura automática de Início quando não restar nenhuma aba. `pageId` identifica
o tipo da página, `tabId` identifica a aba e `instanceKey` fica disponível para
futuras páginas com várias instâncias, como notas ou projetos.

Visualmente, as abas seguem uma faixa de navegador: cada aba é uma peça separada,
a ativa se conecta ao painel e abertura, fechamento e reorder usam somente
transições curtas de até 120 ms. `prefers-reduced-motion` remove esses movimentos.

Enquanto uma aba permanece aberta, seu painel continua montado e apenas os
painéis inativos ficam ocultos. O arquivo `tab-session.json`, no diretório de
dados do usuário, guarda ordem, aba ativa, scroll e o estado JSON declarado por
cada página. Conteúdo de notas, anexos, histórico de edição e outros dados
pesados não pertencem a esse arquivo; cada funcionalidade deverá persistir esses
dados em seu próprio armazenamento.

O processo principal é o único responsável por ler e gravar a sessão. O preload
valida snapshots e respostas do popup antes de atravessar o IPC. Uma sessão com
alguma página além de Início pode ser restaurada na próxima janela; Restaurar
preserva a ordem e a aba ativa, enquanto Ignorar, o timeout ou uma nova navegação
consomem a sessão anterior.

`Ctrl/Cmd+W` fecha a aba ativa, `Ctrl/Cmd+Shift+W` fecha a janela,
`Ctrl+Tab` alterna abas e `Ctrl/Cmd+1–9` seleciona por posição. No macOS,
Fechar aba é enviado pelo menu global ao renderer; comandos privilegiados
continuam restritos ao processo principal.

## Pré-requisitos

- Node.js `24.18.0` e npm correspondente. Use a versão exata para reproduzir o
  lockfile e a CI.
- Python 3 e uma toolchain C++ compatível com `node-gyp`:
  - Windows: Visual Studio Build Tools com **Desktop development with C++**;
  - Ubuntu: `build-essential` e Python 3;
  - macOS: Xcode Command Line Tools.

Confira as versões e instale tudo com:

```console
node --version
npm --version
npm ci
```

Em um checkout sem `package-lock.json`, use `npm install` uma vez para criá-lo.

## Desenvolvimento

```console
npm start
```

O Forge prepara o addon para o Electron, inicia os bundles de main,
preload, utility e renderer e abre a janela. Alterações em C++ exigem uma nova
compilação/reinicialização.

Comandos principais:

| Comando | Finalidade |
| --- | --- |
| `npm run lint` | Verifica as regras estáticas. |
| `npm run typecheck` | Valida TypeScript sem emitir arquivos. |
| `npm test` | Executa os testes unitários com Vitest. |
| `npm run test:native` | Testa `health()` do addon contra o Node.js local. |
| `npm run verify` | Executa lint, tipos e testes unitários/nativos. |
| `npm run package` | Gera o aplicativo com ASAR e fuses endurecidos em `out/`. |
| `npm run make` | Gera os formatos de distribuição configurados para o SO. |

O addon usa a ABI estável do Node-API. Ainda assim, execute `npm run test:native`
antes de `npm run package`; o Forge recompila o módulo para o SO, arquitetura e
runtime de destino durante o empacotamento.

## Testes Electron e pacote final

Os testes Playwright usam o Electron de desenvolvimento para abrir o `app.asar`
empacotado. Assim o artefato original permanece com todos os fuses endurecidos,
enquanto a automação ainda pode inspecionar a janela. Prepare o pacote antes de
executá-los:

```console
npm run package
npm run test:e2e
```

No Linux sem sessão gráfica:

```console
xvfb-run --auto-servernum npm run test:e2e
```

O artefato endurecido é validado sem inspector. Os scripts abaixo localizam o
pacote do SO/arquitetura atual, conferem o ASAR, o addon em
`app.asar.unpacked`, os fuses de segurança e o handshake do núcleo:

```console
node tests/smoke/verify-package.mjs
node tests/smoke/packaged-smoke.mjs
```

No Linux, rode o segundo comando sob `xvfb-run`. A CI executa o fluxo completo
em Windows x64, Ubuntu x64 e macOS arm64 e publica a pasta `out/` como artefato.

## Verificação manual por plataforma

Após `npm start`, confira:

- janela inicial de `1200 × 760`, mínimo `900 × 600`, fundo escuro e marca
  Flyoff centralizada; depois da primeira execução, tamanho, posição e estado
  devem ser restaurados;
- barra superior arrastável, com os controles do Flyoff funcionando no
  Windows, Linux e macOS; no macOS, o menu do aplicativo permanece global;
- menus Arquivo, Editar, Exibir e Ajuda; no macOS, também o menu Flyoff global;
- menus e submenus com clique, teclado, foco restaurado, bordas da janela e a
  mesma cor da barra superior;
- sidebar abrindo uma única aba por página, barra Páginas com ordem por drag and
  drop, indicador ativo e Início reaparecendo ao fechar a última aba;
- `Ctrl/Cmd+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab` e `Ctrl/Cmd+1–9`, além dos atalhos
  nativos de editar, zoom, tela cheia, fechar janela e sair;
- confirmação ao encerrar com páginas abertas e, após relançar com o mesmo
  diretório de dados, os fluxos Restaurar, Ignorar e expiração do aviso;
- aparência e rótulos com o sistema configurado para `pt-BR` e `en-US`;
- `typeof require` e `typeof process` como `undefined` no renderer;
- encerramento sem processo utility órfão.

O serviço de correção já separa idioma da interface e idioma do corretor. Nesta
etapa não existe tela de seleção nem download manual: o Chromium gerencia os
dicionários `.bdic` no Windows/Linux, enquanto o macOS usa as preferências do
sistema.

## Segurança e escopo atual

O app usa `contextIsolation`, sandbox, CSP, bloqueio de navegação/janelas e
protocolo local `flyoff://` no pacote. O ASAR possui validação de integridade e
os fuses de Run as Node, `NODE_OPTIONS` e inspector são desativados.

Ainda estão fora do escopo: editor, persistência, notas, cofres, tela de idiomas,
download real de dicionários, instaladores finais, assinatura, notarização,
atualizador e binários macOS Intel/Windows ARM.
