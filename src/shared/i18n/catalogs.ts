import type { UiLocale } from '../contracts';

export interface TranslationCatalog {
  menu: {
    file: string;
    edit: string;
    view: string;
    help: string;
    closeTab: string;
    closeWindow: string;
    quit: string;
    undo: string;
    redo: string;
    cut: string;
    copy: string;
    paste: string;
    selectAll: string;
    resetZoom: string;
    zoomIn: string;
    zoomOut: string;
    toggleFullScreen: string;
    about: string;
    services: string;
    hide: string;
    hideOthers: string;
    showAll: string;
  };
  windowControls: {
    minimize: string;
    maximize: string;
    restore: string;
    close: string;
  };
  layout: {
    expandSidebar: string;
    collapseSidebar: string;
    resizeSidebar: string;
    resizeRail: string;
  };
  rail: {
    navigation: string;
    project: string;
    graph: string;
    media: string;
    settings: string;
    comingSoon: string;
  };
  graph: {
    appearance: string;
    canvas: string;
    centerStrength: string;
    closeSettings: string;
    damping: string;
    edgeScale: string;
    empty: string;
    fit: string;
    labelZoom: string;
    nodeDistance: string;
    nodeScale: string;
    openInTab: string;
    openSettings: string;
    refresh: string;
    refreshing: string;
    repulsion: string;
    resetSettings: string;
    settings: string;
    simulation: string;
    simulationSpeed: string;
    springStrength: string;
    zoom: string;
    zoomSensitivity: string;
  };
  toolbar: {
    label: string;
    bold: string;
    italic: string;
    strike: string;
    highlight: string;
    code: string;
    heading: string;
    list: string;
    task: string;
    quote: string;
    link: string;
    divider: string;
    emoji: string;
    emojiPicker: string;
    emojiSearch: string;
    emojiRecent: string;
    emojiNoResults: string;
    emojiSkinTone: string;
  };
  home: {
    prompt: string;
    newProject: string;
    importProject: string;
    openProject: string;
    templates: string;
    dragFiles: string;
    navigationHome: string;
    navigation: string;
    thisDevice: string;
    settings: string;
    update: string;
  };
  settings: {
    title: string;
    description: string;
    search: string;
    noResults: string;
    saving: string;
    saved: string;
    saveError: string;
    resetSection: string;
    resetAll: string;
    automatic: string;
    sectionGeneral: string;
    sectionGeneralDescription: string;
    sectionAppearance: string;
    sectionAppearanceDescription: string;
    sectionEditor: string;
    sectionEditorDescription: string;
    sectionWorkspace: string;
    sectionWorkspaceDescription: string;
    sectionDocuments: string;
    sectionDocumentsDescription: string;
    sectionSecurity: string;
    sectionSecurityDescription: string;
    sectionSpellcheck: string;
    sectionSpellcheckDescription: string;
    sectionAccessibility: string;
    sectionAccessibilityDescription: string;
    sectionAbout: string;
    sectionAboutDescription: string;
    startupBehavior: string;
    startupBehaviorDescription: string;
    focusEditorOnOpen: string;
    focusEditorOnOpenDescription: string;
    saveOnWindowBlur: string;
    saveOnWindowBlurDescription: string;
    autosaveDelay: string;
    autosaveDelayDescription: string;
    hardwareAcceleration: string;
    hardwareAccelerationDescription: string;
    restartRequired: string;
    restartNow: string;
    theme: string;
    themeDescription: string;
    themeFlyoffDescription: string;
    themeBasaltDescription: string;
    accentColor: string;
    accentColorDescription: string;
    accentPresets: string;
    accentUseTheme: string;
    accentStrength: string;
    accentStrengthDescription: string;
    interfaceFont: string;
    interfaceFontDescription: string;
    interfaceDensity: string;
    interfaceDensityDescription: string;
    borderContrast: string;
    borderContrastDescription: string;
    scrollbarWidth: string;
    scrollbarWidthDescription: string;
    motion: string;
    motionDescription: string;
    tabWidth: string;
    tabWidthDescription: string;
    activePaneIndicator: string;
    activePaneIndicatorDescription: string;
    defaultEditorMode: string;
    defaultEditorModeDescription: string;
    editorChromeLayout: string;
    editorChromeLayoutDescription: string;
    sourceStyle: string;
    sourceStyleDescription: string;
    showToolbar: string;
    showToolbarDescription: string;
    showLineNumbers: string;
    showLineNumbersDescription: string;
    showStatusBar: string;
    showStatusBarDescription: string;
    wrapLongLines: string;
    wrapLongLinesDescription: string;
    noteFont: string;
    noteFontDescription: string;
    fontSize: string;
    fontSizeDescription: string;
    lineHeight: string;
    lineHeightDescription: string;
    contentWidth: string;
    contentWidthDescription: string;
    contentPadding: string;
    contentPaddingDescription: string;
    editorTabSize: string;
    editorTabSizeDescription: string;
    syncSplitScroll: string;
    syncSplitScrollDescription: string;
    highlightActiveLine: string;
    highlightActiveLineDescription: string;
    fontLigatures: string;
    fontLigaturesDescription: string;
    showTabIcons: string;
    showTabIconsDescription: string;
    tabCloseVisibility: string;
    tabCloseVisibilityDescription: string;
    treeDensity: string;
    treeDensityDescription: string;
    showSearchTips: string;
    showSearchTipsDescription: string;
    showPaneDropLabels: string;
    showPaneDropLabelsDescription: string;
    showPath: string;
    showPathDescription: string;
    propertiesDensity: string;
    propertiesDensityDescription: string;
    showFileExtensions: string;
    showFileExtensionsDescription: string;
    spellcheckEnabled: string;
    spellcheckEnabledDescription: string;
    spellcheckLanguages: string;
    spellcheckLanguagesDescription: string;
    spellcheckManagedByMacOS: string;
    checkCodeBlocks: string;
    checkCodeBlocksDescription: string;
    spellcheckSuggestionLimit: string;
    spellcheckSuggestionLimitDescription: string;
    allowPersonalDictionary: string;
    allowPersonalDictionaryDescription: string;
    focusIndicator: string;
    focusIndicatorDescription: string;
    reduceTransparency: string;
    reduceTransparencyDescription: string;
    lockProtectedOnWindowBlur: string;
    lockProtectedOnWindowBlurDescription: string;
    aboutVersion: string;
    aboutPlatform: string;
    aboutRuntime: string;
    aboutLicense: string;
    aboutLicensePrivate: string;
    aboutEmojiAssets: string;
    aboutSummary: string;
    optionAsk: string;
    optionRestore: string;
    optionFresh: string;
    optionFlyoff: string;
    optionBasalt: string;
    optionSubtle: string;
    optionStandard: string;
    optionStrong: string;
    optionOff: string;
    optionInter: string;
    optionSystemFont: string;
    optionCompact: string;
    optionComfortable: string;
    optionSoft: string;
    optionThin: string;
    optionMotionSystem: string;
    optionMotionFull: string;
    optionMotionReduced: string;
    optionTabCompact: string;
    optionTabBalanced: string;
    optionTabWide: string;
    optionEdit: string;
    optionReading: string;
    optionSplit: string;
    optionFocus: string;
    optionClassic: string;
    optionLive: string;
    optionRaw: string;
    optionArial: string;
    optionSerif: string;
    optionMonospace: string;
    optionNarrow: string;
    optionFullWidth: string;
    optionPaddingNormal: string;
    optionPaddingWide: string;
    optionCloseHover: string;
    optionCloseAlways: string;
    optionPropertiesCompact: string;
    optionPropertiesFull: string;
    milliseconds: string;
    seconds: string;
  };
  projects: {
    navigation: string;
    overview: string;
    closeProject: string;
    emptyWorkspace: string;
    refresh: string;
    add: string;
    addInstance: string;
    searchProject: string;
    noSearchResults: string;
    searchOptions: string;
    searchPathDescription: string;
    searchFileDescription: string;
    searchTagDescription: string;
    searchLineDescription: string;
    searchSectionDescription: string;
    searchPropertyDescription: string;
    searchLockedSkipped: string;
    searching: string;
    searchInstances: string;
    noInstances: string;
    instanceNote: string;
    instanceNoteDescription: string;
    instanceChecklist: string;
    instanceBoard: string;
    instanceGallery: string;
    instanceFolder: string;
    instanceFolderDescription: string;
    comingSoon: string;
    moreActions: string;
    newNote: string;
    newInstance: string;
    newFolder: string;
    branchActions: string;
    expandAll: string;
    collapseAll: string;
    expandItem: string;
    collapseItem: string;
    expandLimitReached: string;
    revealInExplorer: string;
    revealInFinder: string;
    revealInFileManager: string;
    copyPath: string;
    rename: string;
    move: string;
    moveTo: string;
    trash: string;
    openSelected: string;
    moveSelected: string;
    copySelectedPaths: string;
    trashSelected: string;
    selectionLimitReached: string;
    notesSelected: string;
    itemsSelected: string;
    loading: string;
    loadFailed: string;
    operationFailed: string;
    authenticationFailed: string;
    invalidName: string;
    projectName: string;
    location: string;
    chooseLocation: string;
    locationNotSelected: string;
    createProject: string;
    creatingProject: string;
    cancel: string;
    create: string;
    save: string;
    properties: string;
    readOnly: string;
    propertiesTitle: string;
    propertiesGeneral: string;
    propertiesType: string;
    propertiesMarkdownNote: string;
    propertiesContentSize: string;
    propertiesDiskSize: string;
    propertiesCreated: string;
    propertiesModified: string;
    propertiesUnavailable: string;
    propertiesRetry: string;
    propertiesAttributes: string;
    propertiesReadOnly: string;
    propertiesReadOnlyHint: string;
    propertiesProtection: string;
    propertiesProtectionStatus: string;
    propertiesNotProtected: string;
    propertiesLocked: string;
    propertiesUnlocked: string;
    propertiesProtectionWarning: string;
    propertiesDefinePassword: string;
    propertiesChangePassword: string;
    propertiesRemovePassword: string;
    propertiesUnlock: string;
    lockedGreeting: string;
    submitPassword: string;
    propertiesLockNow: string;
    propertiesPassword: string;
    showPassword: string;
    hidePassword: string;
    propertiesCurrentPassword: string;
    propertiesNewPassword: string;
    propertiesCurrentPasswordRequired: string;
    propertiesPasswordRequirements: string;
    propertiesRemoveWarning: string;
    propertiesBack: string;
    propertiesApply: string;
    propertiesOk: string;
    deleteTitle: string;
    deleteFolderDescription: string;
    deletePageDescription: string;
    delete: string;
    rootFolder: string;
    selectDestination: string;
    moveTitle: string;
    moving: string;
    name: string;
    markdownExtension: string;
    editorLabel: string;
    editorContextMenu: string;
    format: string;
    lineActions: string;
    duplicateLine: string;
    deleteLine: string;
    moveLineUp: string;
    moveLineDown: string;
    openLinkContext: string;
    copyLink: string;
    addToDictionary: string;
    goToDefinition: string;
    peekDefinition: string;
    findReferences: string;
    renameSymbol: string;
    changeAllOccurrences: string;
    internalLinkMissing: string;
    chooseLinkTarget: string;
    linkPreview: string;
    previewLocked: string;
    backlinksTitle: string;
    noBacklinks: string;
    backlinksLockedNotice: string;
    renameLinkedNote: string;
    replaceLinkOccurrences: string;
    chooseNewDestination: string;
    searchNotes: string;
    occurrencesFound: string;
    markTask: string;
    unmarkTask: string;
    readingView: string;
    modeEdit: string;
    modeReading: string;
    modeSplit: string;
    editorModeMenu: string;
    collapseToolbar: string;
    expandToolbar: string;
    editorPosition: string;
    line: string;
    column: string;
    selectedOne: string;
    selectedMany: string;
    linkRedirectTitle: string;
    linkRedirectDescription: string;
    linkDestination: string;
    openLink: string;
    linkOpenFailed: string;
    dismissNotice: string;
    notifications: string;
    saving: string;
    saved: string;
    unsaved: string;
    saveFailed: string;
    conflictTitle: string;
    conflictDescription: string;
    reloadFromDisk: string;
    overwrite: string;
    overviewDescription: string;
    unavailable: string;
    projectUnavailable: string;
  };
  pages: {
    bar: string;
    navigation: string;
    home: string;
    thisDevice: string;
    settings: string;
    help: string;
    updateApp: string;
    newTab: string;
    nothingOpenYet: string;
    search: string;
    searchDen: string;
    searchResults: string;
    frequentNotes: string;
    recentlyClosed: string;
    noFrequentNotes: string;
    noRecentlyClosed: string;
    closeAllTabs: string;
    paneMenu: string;
    tabMenu: string;
    splitRight: string;
    splitBelow: string;
    openInPane: string;
    closePane: string;
    resizePane: string;
    closeTab: string;
    failed: string;
  };
  sessionRestore: {
    message: string;
    restore: string;
    ignore: string;
  };
  closeConfirmation: {
    closeWindowTitle: string;
    quitTitle: string;
    restartTitle: string;
    description: string;
    cancel: string;
    closeWindow: string;
    quit: string;
    restart: string;
  };
  errors: {
    nativeCoreStartupTitle: string;
    nativeCoreStartupMessage: string;
    nativeCoreStoppedTitle: string;
    nativeCoreStoppedMessage: string;
  };
}

export type TranslationKey = {
  [Section in keyof TranslationCatalog]: {
    [Key in keyof TranslationCatalog[Section]]: `${Extract<
      Section,
      string
    >}.${Extract<Key, string>}`;
  }[keyof TranslationCatalog[Section]];
}[keyof TranslationCatalog];

export type FlyoffTranslator = (key: TranslationKey) => string;

export const ptBR = {
  menu: {
    file: 'Arquivo',
    edit: 'Editar',
    view: 'Exibir',
    help: 'Ajuda',
    closeTab: 'Fechar aba',
    closeWindow: 'Fechar janela',
    quit: 'Sair',
    undo: 'Desfazer',
    redo: 'Refazer',
    cut: 'Recortar',
    copy: 'Copiar',
    paste: 'Colar',
    selectAll: 'Selecionar tudo',
    resetZoom: 'Restaurar zoom',
    zoomIn: 'Aumentar zoom',
    zoomOut: 'Reduzir zoom',
    toggleFullScreen: 'Tela cheia',
    about: 'Sobre o Flyoff',
    services: 'Serviços',
    hide: 'Ocultar Flyoff',
    hideOthers: 'Ocultar outros',
    showAll: 'Mostrar tudo',
  },
  windowControls: {
    minimize: 'Minimizar',
    maximize: 'Maximizar',
    restore: 'Restaurar',
    close: 'Fechar',
  },
  layout: {
    expandSidebar: 'Expandir barra lateral',
    collapseSidebar: 'Recolher barra lateral',
    resizeSidebar: 'Redimensionar barra lateral',
    resizeRail: 'Redimensionar barra de seções',
  },
  rail: {
    navigation: 'Seções da toca',
    project: 'Toca',
    graph: 'Grafo',
    media: 'Mídia',
    settings: 'Configurações',
    comingSoon: 'Em breve.',
  },
  graph: {
    appearance: 'Aparência',
    canvas: 'Grafo de conexões entre notas',
    centerStrength: 'Força de centralização',
    closeSettings: 'Fechar ajustes do grafo',
    damping: 'Amortecimento',
    edgeScale: 'Espessura das conexões',
    empty: 'Nenhuma conexão para mostrar.',
    fit: 'Ajustar à tela',
    labelZoom: 'Exibição dos nomes',
    nodeDistance: 'Distância entre nós',
    nodeScale: 'Tamanho dos nós',
    openInTab: 'Abrir grafo em uma aba',
    openSettings: 'Ajustar grafo',
    refresh: 'Atualizar grafo',
    refreshing: 'Atualizando grafo',
    repulsion: 'Repulsão',
    resetSettings: 'Restaurar padrões',
    settings: 'Ajustes do grafo',
    simulation: 'Simulação',
    simulationSpeed: 'Velocidade',
    springStrength: 'Elasticidade',
    zoom: 'Câmera',
    zoomSensitivity: 'Sensibilidade do zoom',
  },
  toolbar: {
    label: 'Ferramentas de markdown',
    bold: 'Negrito',
    italic: 'Itálico',
    strike: 'Tachado',
    highlight: 'Destaque',
    code: 'Código',
    heading: 'Título',
    list: 'Lista',
    task: 'Tarefa',
    quote: 'Citação',
    link: 'Link',
    divider: 'Divisor',
    emoji: 'Emoji',
    emojiPicker: 'Escolher emoji',
    emojiSearch: 'Pesquisar emojis',
    emojiRecent: 'Usados recentemente',
    emojiNoResults: 'Nenhum emoji encontrado.',
    emojiSkinTone: 'Tom de pele',
  },
  home: {
    prompt: 'O que vai fazer hoje?',
    newProject: 'Nova toca',
    importProject: 'Importar toca',
    openProject: 'Abrir toca',
    templates: 'Modelos',
    dragFiles: 'Ou arraste arquivos aqui',
    navigationHome: 'Início',
    navigation: 'Navegação',
    thisDevice: 'Este Dispositivo',
    settings: 'Configurações',
    update: 'Atualizar',
  },
  settings: {
    title: 'Configura\u00e7\u00f5es',
    description: 'Ajuste o Flyoff ao seu jeito de trabalhar.',
    search: 'Pesquisar configura\u00e7\u00f5es',
    noResults: 'Nenhuma configura\u00e7\u00e3o encontrada.',
    saving: 'Salvando\u2026',
    saved: 'Salvo',
    saveError: 'N\u00e3o foi poss\u00edvel salvar',
    resetSection: 'Voltar ao padr\u00e3o',
    resetAll: 'Restaurar tudo',
    automatic: 'Autom\u00e1tico',
    sectionGeneral: 'Geral',
    sectionGeneralDescription:
      'Escolha o que acontece ao abrir, editar e sair.',
    sectionAppearance: 'Apar\u00eancia',
    sectionAppearanceDescription:
      'Ajuste as cores, os espa\u00e7os e os detalhes da interface.',
    sectionEditor: 'Editor',
    sectionEditorDescription:
      'Defina como as notas aparecem enquanto voc\u00ea escreve.',
    sectionWorkspace: '\u00c1rea de trabalho',
    sectionWorkspaceDescription:
      'Organize a \u00e1rvore, as abas e os pain\u00e9is.',
    sectionDocuments: 'Arquivos e links',
    sectionDocumentsDescription:
      'Cuide de como arquivos, links e propriedades aparecem.',
    sectionSecurity: 'Seguran\u00e7a e privacidade',
    sectionSecurityDescription:
      'Decida quando notas protegidas voltam a ser bloqueadas.',
    sectionSpellcheck: 'Corretor ortogr\u00e1fico',
    sectionSpellcheckDescription:
      'Escolha o que ser\u00e1 revisado enquanto voc\u00ea escreve.',
    sectionAccessibility: 'Acessibilidade',
    sectionAccessibilityDescription:
      'Deixe o Flyoff mais confort\u00e1vel para navegar.',
    sectionAbout: 'Sobre',
    sectionAboutDescription:
      'Vers\u00e3o, sistema e informa\u00e7\u00f5es do Flyoff.',
    startupBehavior: 'Ao iniciar o Flyoff',
    startupBehaviorDescription:
      'Escolha se as abas da \u00faltima sess\u00e3o devem voltar.',
    focusEditorOnOpen: 'Focar o editor ao abrir notas',
    focusEditorOnOpenDescription:
      'Deixa o cursor pronto para escrever assim que a nota abrir.',
    saveOnWindowBlur: 'Salvar ao trocar de aplicativo',
    saveOnWindowBlurDescription:
      'Salva o que estiver pendente quando voc\u00ea abrir outro aplicativo.',
    autosaveDelay: 'Esperar antes de salvar',
    autosaveDelayDescription:
      'Define quanto tempo o Flyoff espera depois que voc\u00ea para de digitar.',
    hardwareAcceleration: 'Acelera\u00e7\u00e3o por hardware',
    hardwareAccelerationDescription:
      'Usa a GPU para desenhar a interface e manter movimentos mais fluidos.',
    restartRequired: 'Rein\u00edcio necess\u00e1rio',
    restartNow: 'Reiniciar agora',
    theme: 'Tema',
    themeDescription: 'Escolha a apar\u00eancia geral do Flyoff.',
    themeFlyoffDescription:
      'Cinza suave com detalhes em roxo.',
    themeBasaltDescription: 'O visual escuro original do Flyoff.',
    accentColor: 'Cor de destaque',
    accentColorDescription:
      'Escolha a cor usada em controles, seleções, links e no grafo.',
    accentPresets: 'Cores de destaque',
    accentUseTheme: 'Usar cor do tema',
    accentStrength: 'Intensidade do destaque',
    accentStrengthDescription:
      'Escolha quanto destaque aparece nos controles e nas sele\u00e7\u00f5es.',
    interfaceFont: 'Fonte da interface',
    interfaceFontDescription:
      'Muda os menus e controles sem alterar o texto das notas.',
    interfaceDensity: 'Densidade da interface',
    interfaceDensityDescription:
      'Aproxime ou afaste os itens da interface.',
    borderContrast: 'Contraste das divis\u00f3rias',
    borderContrastDescription:
      'Deixe a separa\u00e7\u00e3o entre as \u00e1reas mais suave ou mais vis\u00edvel.',
    scrollbarWidth: 'Largura das barras de rolagem',
    scrollbarWidthDescription:
      'Use barras discretas ou mais f\u00e1ceis de arrastar.',
    motion: 'Movimento da interface',
    motionDescription:
      'Siga a prefer\u00eancia do sistema ou reduza os movimentos.',
    tabWidth: 'Largura das abas',
    tabWidthDescription: 'Escolha quanto espa\u00e7o cada aba pode ocupar.',
    activePaneIndicator: 'Destaque do painel ativo',
    activePaneIndicatorDescription:
      'Ajuste a marca roxa que mostra qual painel est\u00e1 em uso.',
    defaultEditorMode: 'Visualiza\u00e7\u00e3o padr\u00e3o',
    defaultEditorModeDescription:
      'Escolha como cada nova nota deve abrir.',
    editorChromeLayout: 'Layout do editor',
    editorChromeLayoutDescription:
      'Use uma tela mais limpa ou mantenha todos os controles vis\u00edveis.',
    sourceStyle: 'Markdown durante a edi\u00e7\u00e3o',
    sourceStyleDescription:
      'Mostre a formata\u00e7\u00e3o enquanto escreve ou mantenha o Markdown puro.',
    showToolbar: 'Mostrar barra de formata\u00e7\u00e3o',
    showToolbarDescription:
      'Deixa os atalhos de formata\u00e7\u00e3o acima da nota.',
    showLineNumbers: 'Mostrar n\u00fameros de linha',
    showLineNumbersDescription:
      'Mostra um n\u00famero para cada linha real do arquivo.',
    showStatusBar: 'Mostrar linha e coluna',
    showStatusBarDescription:
      'Mostra a posi\u00e7\u00e3o do cursor no rodap\u00e9 do editor.',
    wrapLongLines: 'Quebrar linhas longas',
    wrapLongLinesDescription:
      'Quebra o texto apenas na tela, sem mudar o arquivo.',
    noteFont: 'Fonte dos documentos',
    noteFontDescription: 'Use a mesma fonte para escrever e ler.',
    fontSize: 'Tamanho da fonte',
    fontSizeDescription: 'Ajuste o tamanho do texto das notas.',
    lineHeight: 'Altura da linha',
    lineHeightDescription: 'Aproxime ou afaste as linhas do texto.',
    contentWidth: 'Largura do conte\u00fado',
    contentWidthDescription:
      'Evita linhas compridas demais em telas largas.',
    contentPadding: 'Margens internas',
    contentPaddingDescription:
      'Ajuste o espa\u00e7o entre a nota e as bordas do painel.',
    editorTabSize: 'Tamanho da tabula\u00e7\u00e3o',
    editorTabSizeDescription:
      'Escolha quantos espa\u00e7os uma tabula\u00e7\u00e3o ocupa.',
    syncSplitScroll: 'Sincronizar rolagem no modo Dividido',
    syncSplitScrollDescription:
      'Mant\u00e9m a edi\u00e7\u00e3o e a leitura no mesmo ponto durante a rolagem.',
    highlightActiveLine: 'Destacar linha ativa',
    highlightActiveLineDescription:
      'Marca discretamente a linha em que voc\u00ea est\u00e1 escrevendo.',
    fontLigatures: 'Ligaturas tipogr\u00e1ficas',
    fontLigaturesDescription:
      'Une alguns caracteres quando a fonte escolhida permitir.',
    showTabIcons: 'Mostrar \u00edcones nas abas',
    showTabIconsDescription:
      'Mostra o tipo de conte\u00fado antes do nome da aba.',
    tabCloseVisibility: 'Bot\u00e3o de fechar abas',
    tabCloseVisibilityDescription:
      'Deixe o X sempre vis\u00edvel ou mostre apenas ao passar o ponteiro.',
    treeDensity: 'Densidade da \u00e1rvore',
    treeDensityDescription:
      'Aproxime ou afaste notas e pastas na barra lateral.',
    showSearchTips: 'Mostrar dicas de pesquisa',
    showSearchTipsDescription:
      'Mostra os filtros dispon\u00edveis antes de voc\u00ea pesquisar.',
    showPaneDropLabels: 'Mostrar destino ao arrastar',
    showPaneDropLabelsDescription:
      'Indica onde a aba ser\u00e1 aberta antes de voc\u00ea solt\u00e1-la.',
    showPath: 'Mostrar caminho da nota',
    showPathDescription:
      'Mostra onde a nota est\u00e1 guardada no cabe\u00e7alho do editor.',
    propertiesDensity: 'Densidade das propriedades',
    propertiesDensityDescription:
      'Mostre apenas o essencial ou todos os detalhes.',
    showFileExtensions: 'Mostrar extens\u00f5es na \u00e1rvore',
    showFileExtensionsDescription:
      'Mostra .md depois do nome de cada nota.',
    spellcheckEnabled: 'Ativar corretor ortogr\u00e1fico',
    spellcheckEnabledDescription:
      'Sinaliza palavras que podem estar escritas incorretamente.',
    spellcheckLanguages: 'Idiomas',
    spellcheckLanguagesDescription:
      'Se nenhum for escolhido, o Flyoff usa os idiomas do sistema.',
    spellcheckManagedByMacOS:
      'A sele\u00e7\u00e3o de idiomas \u00e9 gerenciada pelo macOS.',
    checkCodeBlocks: 'Verificar blocos de c\u00f3digo',
    checkCodeBlocksDescription:
      'Tamb\u00e9m procura erros dentro de blocos de c\u00f3digo.',
    spellcheckSuggestionLimit: 'Sugest\u00f5es por palavra',
    spellcheckSuggestionLimitDescription:
      'Escolha quantas corre\u00e7\u00f5es aparecem no menu do editor.',
    allowPersonalDictionary: 'Permitir dicion\u00e1rio pessoal',
    allowPersonalDictionaryDescription:
      'Permite guardar palavras que o corretor ainda n\u00e3o conhece.',
    focusIndicator: 'Indicador de foco',
    focusIndicatorDescription:
      'Deixa mais claro qual controle est\u00e1 selecionado pelo teclado.',
    reduceTransparency: 'Reduzir transpar\u00eancia',
    reduceTransparencyDescription:
      'Remove a transpar\u00eancia de menus e indicadores de arrasto.',
    lockProtectedOnWindowBlur: 'Bloquear notas ao sair da janela',
    lockProtectedOnWindowBlurDescription:
      'Protege novamente as notas abertas quando voc\u00ea troca de aplicativo.',
    aboutVersion: 'Vers\u00e3o do Flyoff',
    aboutPlatform: 'Sistema',
    aboutRuntime: 'Tecnologia',
    aboutLicense: 'Licen\u00e7a',
    aboutLicensePrivate: 'Uso privado',
    aboutEmojiAssets: 'Emojis e atribui\u00e7\u00f5es',
    aboutSummary:
      'Um lugar privado e flex\u00edvel para suas notas Markdown.',
    optionAsk: 'Perguntar',
    optionRestore: 'Restaurar automaticamente',
    optionFresh: 'Come\u00e7ar limpo',
    optionFlyoff: 'Flyoff',
    optionBasalt: 'Basalt',
    optionSubtle: 'Discreta',
    optionStandard: 'Padr\u00e3o',
    optionStrong: 'Forte',
    optionOff: 'Desativado',
    optionInter: 'Inter',
    optionSystemFont: 'Fonte do sistema',
    optionCompact: 'Compacta',
    optionComfortable: 'Confort\u00e1vel',
    optionSoft: 'Suave',
    optionThin: 'Fina',
    optionMotionSystem: 'Seguir o sistema',
    optionMotionFull: 'Completo',
    optionMotionReduced: 'Reduzido',
    optionTabCompact: 'Compacta',
    optionTabBalanced: 'Equilibrada',
    optionTabWide: 'Ampla',
    optionEdit: 'Edi\u00e7\u00e3o',
    optionReading: 'Leitura',
    optionSplit: 'Dividido',
    optionFocus: 'Foco',
    optionClassic: 'Cl\u00e1ssico',
    optionLive: 'Formata\u00e7\u00e3o ao digitar',
    optionRaw: 'Markdown puro',
    optionArial: 'Arial',
    optionSerif: 'Serifada',
    optionMonospace: 'Monoespa\u00e7ada',
    optionNarrow: 'Estreita',
    optionFullWidth: 'Total',
    optionPaddingNormal: 'Normal',
    optionPaddingWide: 'Ampla',
    optionCloseHover: 'Durante a intera\u00e7\u00e3o',
    optionCloseAlways: 'Sempre vis\u00edvel',
    optionPropertiesCompact: 'Compacta',
    optionPropertiesFull: 'Completa',
    milliseconds: 'ms',
    seconds: 's',
  },
  projects: {
    navigation: 'Conteúdo da toca',
    overview: 'Visão geral',
    closeProject: 'Fechar toca',
    emptyWorkspace: 'Nenhuma aba aberta.',
    refresh: 'Atualizar',
    add: 'Adicionar',
    addInstance: 'Adicionar instância',
    searchProject: 'Pesquisar nesta toca',
    noSearchResults: 'Nenhum resultado encontrado.',
    searchOptions: 'Opções de busca',
    searchPathDescription: 'corresponder caminho da nota',
    searchFileDescription: 'corresponder nome do arquivo',
    searchTagDescription: 'buscar tags',
    searchLineDescription: 'buscar palavras na mesma linha',
    searchSectionDescription: 'buscar palavras na mesma seção',
    searchPropertyDescription: 'corresponder propriedade',
    searchLockedSkipped:
      'O conteúdo de notas bloqueadas não foi pesquisado.',
    searching: 'Pesquisando…',
    searchInstances: 'Buscar instâncias',
    noInstances: 'Nenhuma instância encontrada.',
    instanceNote: 'Nota',
    instanceNoteDescription: 'Markdown',
    instanceChecklist: 'Checklist',
    instanceBoard: 'Quadro',
    instanceGallery: 'Galeria',
    instanceFolder: 'Pasta',
    instanceFolderDescription: 'Organiza outras instâncias',
    comingSoon: 'Em breve',
    moreActions: 'Mais ações',
    newNote: 'Nova nota',
    newInstance: 'Nova instância',
    newFolder: 'Nova pasta',
    branchActions: 'Ações da pasta',
    expandAll: 'Expandir tudo',
    collapseAll: 'Colapsar tudo',
    expandItem: 'Expandir',
    collapseItem: 'Recolher',
    expandLimitReached:
      'A expansão foi interrompida após 500 pastas para manter o Flyoff responsivo.',
    revealInExplorer: 'Mostrar no Explorador de Arquivos',
    revealInFinder: 'Mostrar no Finder',
    revealInFileManager: 'Mostrar no gerenciador de arquivos',
    copyPath: 'Copiar caminho',
    rename: 'Renomear',
    move: 'Mover',
    moveTo: 'Mover para…',
    trash: 'Mover para a lixeira',
    openSelected: 'Abrir selecionadas',
    moveSelected: 'Mover selecionadas\u2026',
    copySelectedPaths: 'Copiar caminhos',
    trashSelected: 'Excluir selecionadas',
    selectionLimitReached:
      'A sele\u00e7\u00e3o foi limitada a 500 itens.',
    notesSelected: 'notas selecionadas ser\u00e3o movidas para a lixeira.',
    itemsSelected: 'itens selecionados ser\u00e3o movidos para a lixeira.',
    loading: 'Carregando…',
    loadFailed: 'Não foi possível carregar esta pasta.',
    operationFailed: 'Não foi possível concluir a operação.',
    invalidName:
      'Use de 1 a 100 caracteres e evite separadores, controles, ponto ou espaço no final e nomes reservados.',
    projectName: 'Nome da toca',
    location: 'Local',
    chooseLocation: 'Escolher local',
    locationNotSelected: 'Escolha onde a toca será criada.',
    createProject: 'Criar toca',
    creatingProject: 'Criando toca…',
    cancel: 'Cancelar',
    create: 'Criar',
    save: 'Salvar',
    properties: 'Propriedades\u2026',
    readOnly: 'Somente leitura',
    propertiesTitle: 'Propriedades da nota',
    propertiesGeneral: 'Geral',
    propertiesType: 'Tipo',
    propertiesMarkdownNote: 'Nota Markdown',
    propertiesContentSize: 'Tamanho do conte\u00fado',
    propertiesDiskSize: 'Tamanho no disco',
    propertiesCreated: 'Criado',
    propertiesModified: 'Modificado',
    propertiesUnavailable: 'N\u00e3o dispon\u00edvel',
    propertiesRetry: 'Tentar novamente',
    propertiesAttributes: 'Atributos',
    propertiesReadOnly: 'Somente leitura',
    propertiesReadOnlyHint:
      'Impede edi\u00e7\u00e3o no Flyoff; n\u00e3o altera as permiss\u00f5es do arquivo.',
    propertiesProtection: 'Prote\u00e7\u00e3o',
    propertiesProtectionStatus: 'Estado',
    propertiesNotProtected: 'Sem senha',
    propertiesLocked: 'Bloqueada',
    propertiesUnlocked: 'Desbloqueada',
    propertiesProtectionWarning:
      'A criptografia protege o conte\u00fado no disco. N\u00e3o h\u00e1 recupera\u00e7\u00e3o de senha. Enquanto desbloqueados, texto e senha passam pela mem\u00f3ria; backups e vers\u00f5es anteriores n\u00e3o s\u00e3o apagados. Nome, caminho e metadados continuam vis\u00edveis.',
    propertiesDefinePassword: 'Definir senha',
    propertiesChangePassword: 'Alterar senha',
    propertiesRemovePassword: 'Remover senha',
    propertiesUnlock: 'Desbloquear',
    lockedGreeting:
      'Opa! Parece que essa nota\nest\u00e1 criptografada.',
    submitPassword: 'Enviar',
    propertiesLockNow: 'Bloquear agora',
    propertiesPassword: 'Senha',
    showPassword: 'Mostrar senha',
    hidePassword: 'Ocultar senha',
    propertiesCurrentPassword: 'Senha atual',
    propertiesNewPassword: 'Nova senha',
    propertiesCurrentPasswordRequired: 'Digite a senha atual.',
    propertiesPasswordRequirements:
      'Use pelo menos 1 caractere e no m\u00e1ximo 1024 bytes.',
    authenticationFailed: 'Senha incorreta ou arquivo danificado.',
    propertiesRemoveWarning:
      'Ao remover a prote\u00e7\u00e3o, o conte\u00fado voltar\u00e1 a ser leg\u00edvel no arquivo Markdown.',
    propertiesBack: 'Voltar',
    propertiesApply: 'Aplicar',
    propertiesOk: 'OK',
    deleteTitle: 'Mover para a lixeira?',
    deleteFolderDescription:
      'A pasta e todo o conteúdo dentro dela, incluindo arquivos ocultos pelo Flyoff, serão movidos para a lixeira.',
    deletePageDescription: 'A nota será movida para a lixeira.',
    delete: 'Mover para a lixeira',
    rootFolder: 'Raiz da toca',
    selectDestination: 'Escolha a pasta de destino.',
    moveTitle: 'Mover item',
    moving: 'Movendo…',
    name: 'Nome',
    markdownExtension: 'Extensão Markdown',
    editorLabel: 'Editor Markdown',
    editorContextMenu: 'A\u00e7\u00f5es do editor',
    format: 'Formatar',
    lineActions: 'Linha',
    duplicateLine: 'Duplicar linha',
    deleteLine: 'Excluir linha',
    moveLineUp: 'Mover linha para cima',
    moveLineDown: 'Mover linha para baixo',
    openLinkContext: 'Abrir link',
    copyLink: 'Copiar endere\u00e7o',
    addToDictionary: 'Adicionar ao dicion\u00e1rio',
    goToDefinition: 'Ir para defini\u00e7\u00e3o',
    peekDefinition: 'Espiar',
    findReferences: 'Localizar refer\u00eancias',
    renameSymbol: 'Renomear s\u00edmbolo',
    changeAllOccurrences: 'Alterar todas as ocorr\u00eancias',
    internalLinkMissing: 'A nota referenciada n\u00e3o foi encontrada.',
    chooseLinkTarget: 'Escolher destino',
    linkPreview: 'Pr\u00e9-visualiza\u00e7\u00e3o',
    previewLocked: 'Esta nota est\u00e1 bloqueada.',
    backlinksTitle: 'Refer\u00eancias',
    noBacklinks: 'Nenhuma refer\u00eancia encontrada.',
    backlinksLockedNotice:
      'Notas protegidas bloqueadas n\u00e3o foram pesquisadas.',
    renameLinkedNote: 'Renomear nota vinculada',
    replaceLinkOccurrences: 'Alterar links nesta nota',
    chooseNewDestination: 'Escolha o novo destino.',
    searchNotes: 'Buscar notas',
    occurrencesFound: 'links ser\u00e3o alterados',
    markTask: 'Marcar tarefa',
    unmarkTask: 'Desmarcar tarefa',
    readingView: 'Leitura',
    modeEdit: 'Edição',
    modeReading: 'Leitura',
    modeSplit: 'Dividido',
    editorModeMenu: 'Op\u00e7\u00f5es da nota',
    collapseToolbar: 'Recolher barra de formata\u00e7\u00e3o',
    expandToolbar: 'Mostrar barra de formata\u00e7\u00e3o',
    editorPosition: 'Posição no documento',
    line: 'Linha',
    column: 'Coluna',
    selectedOne: 'selecionado',
    selectedMany: 'selecionados',
    linkRedirectTitle: 'Abrir link externo?',
    linkRedirectDescription: 'Você será redirecionado para:',
    linkDestination: 'Destino',
    openLink: 'Abrir',
    linkOpenFailed: 'Não foi possível abrir o link.',
    dismissNotice: 'Fechar aviso',
    notifications: 'Notificações',
    saving: 'Salvando…',
    saved: 'Salvo',
    unsaved: 'Alterações não salvas',
    saveFailed: 'Não foi possível salvar a nota.',
    conflictTitle: 'A nota foi alterada fora do Flyoff',
    conflictDescription:
      'Recarregue a versão do disco ou sobrescreva a alteração externa.',
    reloadFromDisk: 'Recarregar do disco',
    overwrite: 'Sobrescrever',
    overviewDescription: 'Organize as pastas e notas desta toca pela barra lateral.',
    unavailable: 'Este conteúdo não está mais disponível.',
    projectUnavailable: 'A toca da sessão anterior não pôde ser aberta.',
  },
  pages: {
    bar: 'Páginas',
    navigation: 'Navegação',
    home: 'Início',
    thisDevice: 'Este dispositivo',
    settings: 'Configurações',
    help: 'Ajuda',
    updateApp: 'Atualizar aplicativo',
    newTab: 'Nova aba',
    nothingOpenYet: 'Nada aberto ainda',
    search: 'Pesquisar',
    searchDen: 'Pesquisar nesta toca',
    searchResults: 'Resultados da pesquisa',
    frequentNotes: 'Abertas com frequência',
    recentlyClosed: 'Fechadas recentemente',
    noFrequentNotes: 'Suas notas mais acessadas aparecerão aqui.',
    noRecentlyClosed: 'Nenhuma nota fechada recentemente.',
    closeAllTabs: 'Fechar todas as abas',
    paneMenu: 'Ações do painel',
    tabMenu: 'Ações da aba',
    splitRight: 'Dividir à direita',
    splitBelow: 'Dividir abaixo',
    openInPane: 'Abrir neste painel',
    closePane: 'Fechar painel',
    resizePane: 'Redimensionar painéis',
    closeTab: 'Fechar aba',
    failed: 'Não foi possível exibir esta página.',
  },
  sessionRestore: {
    message: 'Restaurar abas da última sessão?',
    restore: 'Restaurar',
    ignore: 'Ignorar',
  },
  closeConfirmation: {
    closeWindowTitle: 'Fechar janela?',
    quitTitle: 'Sair do Flyoff?',
    restartTitle: 'Reiniciar o Flyoff?',
    description:
      'Você poderá restaurar as páginas abertas na próxima sessão.',
    cancel: 'Cancelar',
    closeWindow: 'Fechar janela',
    quit: 'Sair',
    restart: 'Reiniciar',
  },
  errors: {
    nativeCoreStartupTitle: 'Não foi possível iniciar o Flyoff',
    nativeCoreStartupMessage:
      'O núcleo do aplicativo não pôde ser iniciado.',
    nativeCoreStoppedTitle: 'O Flyoff foi interrompido',
    nativeCoreStoppedMessage:
      'O núcleo do aplicativo foi encerrado inesperadamente.',
  },
} as const satisfies TranslationCatalog;

export const enUS = {
  menu: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    help: 'Help',
    closeTab: 'Close Tab',
    closeWindow: 'Close Window',
    quit: 'Quit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    resetZoom: 'Reset Zoom',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullScreen: 'Full Screen',
    about: 'About Flyoff',
    services: 'Services',
    hide: 'Hide Flyoff',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
  },
  windowControls: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
  },
  layout: {
    expandSidebar: 'Expand sidebar',
    collapseSidebar: 'Collapse sidebar',
    resizeSidebar: 'Resize sidebar',
    resizeRail: 'Resize section bar',
  },
  rail: {
    navigation: 'Den sections',
    project: 'Den',
    graph: 'Graph',
    media: 'Media',
    settings: 'Settings',
    comingSoon: 'Coming soon.',
  },
  graph: {
    appearance: 'Appearance',
    canvas: 'Graph of connections between notes',
    centerStrength: 'Centering force',
    closeSettings: 'Close graph settings',
    damping: 'Damping',
    edgeScale: 'Connection thickness',
    empty: 'No connections to show.',
    fit: 'Fit to view',
    labelZoom: 'Label visibility',
    nodeDistance: 'Node distance',
    nodeScale: 'Node size',
    openInTab: 'Open graph in a tab',
    openSettings: 'Adjust graph',
    refresh: 'Refresh graph',
    refreshing: 'Refreshing graph',
    repulsion: 'Repulsion',
    resetSettings: 'Restore defaults',
    settings: 'Graph settings',
    simulation: 'Simulation',
    simulationSpeed: 'Speed',
    springStrength: 'Elasticity',
    zoom: 'Camera',
    zoomSensitivity: 'Zoom sensitivity',
  },
  toolbar: {
    label: 'Markdown tools',
    bold: 'Bold',
    italic: 'Italic',
    strike: 'Strike',
    highlight: 'Highlight',
    code: 'Code',
    heading: 'Heading',
    list: 'List',
    task: 'Task',
    quote: 'Quote',
    link: 'Link',
    divider: 'Divider',
    emoji: 'Emoji',
    emojiPicker: 'Choose emoji',
    emojiSearch: 'Search emoji',
    emojiRecent: 'Recently used',
    emojiNoResults: 'No emoji found.',
    emojiSkinTone: 'Skin tone',
  },
  home: {
    prompt: 'What would you like to do today?',
    newProject: 'New den',
    importProject: 'Import den',
    openProject: 'Open den',
    templates: 'Templates',
    dragFiles: 'Or drag files here',
    navigationHome: 'Home',
    navigation: 'Navigation',
    thisDevice: 'This Device',
    settings: 'Settings',
    update: 'Update',
  },
  settings: {
    title: 'Settings',
    description: 'Adjust Flyoff to the way you work.',
    search: 'Search settings',
    noResults: 'No settings found.',
    saving: 'Saving\u2026',
    saved: 'Saved',
    saveError: 'Could not save',
    resetSection: 'Restore defaults',
    resetAll: 'Restore everything',
    automatic: 'Automatic',
    sectionGeneral: 'General',
    sectionGeneralDescription: 'Choose what happens when you open, edit, and leave.',
    sectionAppearance: 'Appearance',
    sectionAppearanceDescription: 'Adjust colors, spacing, and interface details.',
    sectionEditor: 'Editor',
    sectionEditorDescription: 'Choose how notes look while you write.',
    sectionWorkspace: 'Workspace',
    sectionWorkspaceDescription: 'Organize the tree, tabs, and panes.',
    sectionDocuments: 'Files and links',
    sectionDocumentsDescription:
      'Control how files, links, and properties appear.',
    sectionSecurity: 'Security and privacy',
    sectionSecurityDescription: 'Choose when protected notes lock again.',
    sectionSpellcheck: 'Spellcheck',
    sectionSpellcheckDescription: 'Choose what gets checked while you write.',
    sectionAccessibility: 'Accessibility',
    sectionAccessibilityDescription:
      'Make Flyoff more comfortable to navigate.',
    sectionAbout: 'About',
    sectionAboutDescription: 'Version, system, and Flyoff information.',
    startupBehavior: 'When Flyoff starts',
    startupBehaviorDescription:
      'Choose whether tabs from your last session should return.',
    focusEditorOnOpen: 'Focus editor when opening notes',
    focusEditorOnOpenDescription:
      'Leaves the cursor ready to write as soon as a note opens.',
    saveOnWindowBlur: 'Save when switching apps',
    saveOnWindowBlurDescription:
      'Saves pending changes when you switch to another app.',
    autosaveDelay: 'Wait before saving',
    autosaveDelayDescription:
      'Sets how long Flyoff waits after you stop typing.',
    hardwareAcceleration: 'Hardware acceleration',
    hardwareAccelerationDescription:
      'Uses the GPU to draw the interface and keep motion smooth.',
    restartRequired: 'Restart required',
    restartNow: 'Restart now',
    theme: 'Theme',
    themeDescription: 'Choose Flyoff\u2019s overall appearance.',
    themeFlyoffDescription:
      'Soft gray with purple details.',
    themeBasaltDescription: 'Flyoff\u2019s original dark look.',
    accentColor: 'Accent color',
    accentColorDescription:
      'Choose the color used for controls, selections, links, and the graph.',
    accentPresets: 'Accent colors',
    accentUseTheme: 'Use theme color',
    accentStrength: 'Accent strength',
    accentStrengthDescription:
      'Choose how much accent appears in controls and selections.',
    interfaceFont: 'Interface font',
    interfaceFontDescription:
      'Changes menus and controls without affecting note text.',
    interfaceDensity: 'Interface density',
    interfaceDensityDescription:
      'Move interface items closer together or farther apart.',
    borderContrast: 'Divider contrast',
    borderContrastDescription:
      'Make the separation between areas softer or more visible.',
    scrollbarWidth: 'Scrollbar width',
    scrollbarWidthDescription:
      'Use discreet scrollbars or ones that are easier to drag.',
    motion: 'Interface motion',
    motionDescription:
      'Follow your system preference or reduce motion.',
    tabWidth: 'Tab width',
    tabWidthDescription: 'Choose how much space each tab can occupy.',
    activePaneIndicator: 'Active pane indicator',
    activePaneIndicatorDescription:
      'Adjust the purple mark that identifies the pane in use.',
    defaultEditorMode: 'Default view',
    defaultEditorModeDescription:
      'Choose how each new note should open.',
    editorChromeLayout: 'Editor layout',
    editorChromeLayoutDescription:
      'Use a cleaner workspace or keep every control visible.',
    sourceStyle: 'Markdown while editing',
    sourceStyleDescription:
      'Show formatting as you type or keep the Markdown plain.',
    showToolbar: 'Show formatting toolbar',
    showToolbarDescription: 'Keeps formatting shortcuts above the note.',
    showLineNumbers: 'Show line numbers',
    showLineNumbersDescription: 'Shows one number for each real line in the file.',
    showStatusBar: 'Show line and column',
    showStatusBarDescription:
      'Shows the cursor position at the bottom of the editor.',
    wrapLongLines: 'Wrap long lines',
    wrapLongLinesDescription:
      'Wraps text on screen without changing the file.',
    noteFont: 'Document font',
    noteFontDescription: 'Use the same font for writing and reading.',
    fontSize: 'Font size',
    fontSizeDescription: 'Adjust the text size in notes.',
    lineHeight: 'Line height',
    lineHeightDescription: 'Move lines of text closer together or farther apart.',
    contentWidth: 'Content width',
    contentWidthDescription: 'Avoid lines that are too long on wide screens.',
    contentPadding: 'Content margins',
    contentPaddingDescription:
      'Adjust the space between a note and the pane edges.',
    editorTabSize: 'Tab size',
    editorTabSizeDescription:
      'Choose how many spaces a tab occupies.',
    syncSplitScroll: 'Synchronize Split view scrolling',
    syncSplitScrollDescription:
      'Keeps editing and reading at the same point while you scroll.',
    highlightActiveLine: 'Highlight active line',
    highlightActiveLineDescription:
      'Subtly marks the line where you are writing.',
    fontLigatures: 'Font ligatures',
    fontLigaturesDescription:
      'Joins certain characters when the selected font supports it.',
    showTabIcons: 'Show icons in tabs',
    showTabIconsDescription: 'Shows the content type before the tab name.',
    tabCloseVisibility: 'Tab close button',
    tabCloseVisibilityDescription:
      'Keep the X visible or show it only when you point at the tab.',
    treeDensity: 'Tree density',
    treeDensityDescription: 'Move notes and folders closer together or farther apart.',
    showSearchTips: 'Show search tips',
    showSearchTipsDescription:
      'Shows available filters before you start searching.',
    showPaneDropLabels: 'Show destination while dragging',
    showPaneDropLabelsDescription:
      'Shows where the tab will open before you drop it.',
    showPath: 'Show note path',
    showPathDescription:
      'Shows where the note is stored in the editor header.',
    propertiesDensity: 'Properties density',
    propertiesDensityDescription:
      'Show only the essentials or every detail.',
    showFileExtensions: 'Show extensions in the tree',
    showFileExtensionsDescription:
      'Shows .md after each note name.',
    spellcheckEnabled: 'Enable spellcheck',
    spellcheckEnabledDescription:
      'Marks words that may be misspelled.',
    spellcheckLanguages: 'Languages',
    spellcheckLanguagesDescription:
      'If none are selected, Flyoff uses the system languages.',
    spellcheckManagedByMacOS:
      'Language selection is managed by macOS.',
    checkCodeBlocks: 'Check code blocks',
    checkCodeBlocksDescription:
      'Also looks for mistakes inside code blocks.',
    spellcheckSuggestionLimit: 'Suggestions per word',
    spellcheckSuggestionLimitDescription:
      'Choose how many corrections appear in the editor menu.',
    allowPersonalDictionary: 'Allow personal dictionary',
    allowPersonalDictionaryDescription:
      'Lets you save words the spellchecker does not know yet.',
    focusIndicator: 'Focus indicator',
    focusIndicatorDescription:
      'Makes the control selected with the keyboard easier to see.',
    reduceTransparency: 'Reduce transparency',
    reduceTransparencyDescription:
      'Removes transparency from menus and drag indicators.',
    lockProtectedOnWindowBlur: 'Lock notes when leaving the window',
    lockProtectedOnWindowBlurDescription:
      'Protects open notes again when you switch to another app.',
    aboutVersion: 'Flyoff version',
    aboutPlatform: 'System',
    aboutRuntime: 'Technology',
    aboutLicense: 'License',
    aboutLicensePrivate: 'Private use',
    aboutEmojiAssets: 'Emoji and attribution',
    aboutSummary:
      'A private and flexible place for your Markdown notes.',
    optionAsk: 'Ask',
    optionRestore: 'Restore automatically',
    optionFresh: 'Start fresh',
    optionFlyoff: 'Flyoff',
    optionBasalt: 'Basalt',
    optionSubtle: 'Subtle',
    optionStandard: 'Standard',
    optionStrong: 'Strong',
    optionOff: 'Off',
    optionInter: 'Inter',
    optionSystemFont: 'System font',
    optionCompact: 'Compact',
    optionComfortable: 'Comfortable',
    optionSoft: 'Soft',
    optionThin: 'Thin',
    optionMotionSystem: 'Follow system',
    optionMotionFull: 'Full',
    optionMotionReduced: 'Reduced',
    optionTabCompact: 'Compact',
    optionTabBalanced: 'Balanced',
    optionTabWide: 'Wide',
    optionEdit: 'Edit',
    optionReading: 'Reading',
    optionSplit: 'Split',
    optionFocus: 'Focus',
    optionClassic: 'Classic',
    optionLive: 'Formatting as you type',
    optionRaw: 'Plain Markdown',
    optionArial: 'Arial',
    optionSerif: 'Serif',
    optionMonospace: 'Monospace',
    optionNarrow: 'Narrow',
    optionFullWidth: 'Full',
    optionPaddingNormal: 'Normal',
    optionPaddingWide: 'Wide',
    optionCloseHover: 'During interaction',
    optionCloseAlways: 'Always visible',
    optionPropertiesCompact: 'Compact',
    optionPropertiesFull: 'Full',
    milliseconds: 'ms',
    seconds: 's',
  },
  projects: {
    navigation: 'Den contents',
    overview: 'Overview',
    closeProject: 'Close den',
    emptyWorkspace: 'No tab open.',
    refresh: 'Refresh',
    add: 'Add',
    addInstance: 'Add instance',
    searchProject: 'Search this den',
    noSearchResults: 'No results found.',
    searchOptions: 'Search options',
    searchPathDescription: 'match note path',
    searchFileDescription: 'match file name',
    searchTagDescription: 'search tags',
    searchLineDescription: 'search words on the same line',
    searchSectionDescription: 'search words in the same section',
    searchPropertyDescription: 'match property',
    searchLockedSkipped: 'Locked note content was not searched.',
    searching: 'Searching…',
    searchInstances: 'Search instances',
    noInstances: 'No instances found.',
    instanceNote: 'Note',
    instanceNoteDescription: 'Markdown',
    instanceChecklist: 'Checklist',
    instanceBoard: 'Board',
    instanceGallery: 'Gallery',
    instanceFolder: 'Folder',
    instanceFolderDescription: 'Organizes other instances',
    comingSoon: 'Coming soon',
    moreActions: 'More actions',
    newNote: 'New note',
    newInstance: 'New instance',
    newFolder: 'New folder',
    branchActions: 'Folder actions',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    expandItem: 'Expand',
    collapseItem: 'Collapse',
    expandLimitReached:
      'Expansion stopped after 500 folders to keep Flyoff responsive.',
    revealInExplorer: 'Show in File Explorer',
    revealInFinder: 'Show in Finder',
    revealInFileManager: 'Show in file manager',
    copyPath: 'Copy path',
    rename: 'Rename',
    move: 'Move',
    moveTo: 'Move to…',
    trash: 'Move to trash',
    openSelected: 'Open selected',
    moveSelected: 'Move selected\u2026',
    copySelectedPaths: 'Copy paths',
    trashSelected: 'Delete selected',
    selectionLimitReached:
      'The selection was limited to 500 items.',
    notesSelected: 'selected notes will be moved to the trash.',
    itemsSelected: 'selected items will be moved to the trash.',
    loading: 'Loading…',
    loadFailed: 'This folder could not be loaded.',
    operationFailed: 'The operation could not be completed.',
    invalidName:
      'Use 1 to 100 characters and avoid separators, controls, trailing dots or spaces, and reserved names.',
    projectName: 'Den name',
    location: 'Location',
    chooseLocation: 'Choose location',
    locationNotSelected: 'Choose where the den will be created.',
    createProject: 'Create den',
    creatingProject: 'Creating den…',
    cancel: 'Cancel',
    create: 'Create',
    save: 'Save',
    properties: 'Properties\u2026',
    readOnly: 'Read-only',
    propertiesTitle: 'Note properties',
    propertiesGeneral: 'General',
    propertiesType: 'Type',
    propertiesMarkdownNote: 'Markdown note',
    propertiesContentSize: 'Content size',
    propertiesDiskSize: 'Size on disk',
    propertiesCreated: 'Created',
    propertiesModified: 'Modified',
    propertiesUnavailable: 'Not available',
    propertiesRetry: 'Try again',
    propertiesAttributes: 'Attributes',
    propertiesReadOnly: 'Read-only',
    propertiesReadOnlyHint:
      'Prevents editing in Flyoff; it does not change file permissions.',
    propertiesProtection: 'Protection',
    propertiesProtectionStatus: 'Status',
    propertiesNotProtected: 'No password',
    propertiesLocked: 'Locked',
    propertiesUnlocked: 'Unlocked',
    propertiesProtectionWarning:
      'Encryption protects content on disk. Passwords cannot be recovered. While unlocked, text and passwords pass through memory; backups and earlier versions are not erased. Names, paths, and metadata remain visible.',
    propertiesDefinePassword: 'Set password',
    propertiesChangePassword: 'Change password',
    propertiesRemovePassword: 'Remove password',
    propertiesUnlock: 'Unlock',
    lockedGreeting:
      'Hey! It looks like this note\nis encrypted.',
    submitPassword: 'Submit',
    propertiesLockNow: 'Lock now',
    propertiesPassword: 'Password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    propertiesCurrentPassword: 'Current password',
    propertiesNewPassword: 'New password',
    propertiesCurrentPasswordRequired: 'Enter the current password.',
    propertiesPasswordRequirements:
      'Use at least 1 character and no more than 1024 bytes.',
    authenticationFailed: 'Incorrect password or damaged file.',
    propertiesRemoveWarning:
      'Removing protection makes the content readable in the Markdown file again.',
    propertiesBack: 'Back',
    propertiesApply: 'Apply',
    propertiesOk: 'OK',
    deleteTitle: 'Move to trash?',
    deleteFolderDescription:
      'The folder and everything inside it, including files hidden by Flyoff, will be moved to the trash.',
    deletePageDescription: 'The note will be moved to the trash.',
    delete: 'Move to trash',
    rootFolder: 'Den root',
    selectDestination: 'Choose the destination folder.',
    moveTitle: 'Move item',
    moving: 'Moving…',
    name: 'Name',
    markdownExtension: 'Markdown extension',
    editorLabel: 'Markdown editor',
    editorContextMenu: 'Editor actions',
    format: 'Format',
    lineActions: 'Line',
    duplicateLine: 'Duplicate line',
    deleteLine: 'Delete line',
    moveLineUp: 'Move line up',
    moveLineDown: 'Move line down',
    openLinkContext: 'Open link',
    copyLink: 'Copy address',
    addToDictionary: 'Add to dictionary',
    goToDefinition: 'Go to definition',
    peekDefinition: 'Peek',
    findReferences: 'Find references',
    renameSymbol: 'Rename symbol',
    changeAllOccurrences: 'Change all occurrences',
    internalLinkMissing: 'The referenced note was not found.',
    chooseLinkTarget: 'Choose target',
    linkPreview: 'Preview',
    previewLocked: 'This note is locked.',
    backlinksTitle: 'References',
    noBacklinks: 'No references found.',
    backlinksLockedNotice:
      'Locked protected notes were not searched.',
    renameLinkedNote: 'Rename linked note',
    replaceLinkOccurrences: 'Change links in this note',
    chooseNewDestination: 'Choose the new destination.',
    searchNotes: 'Search notes',
    occurrencesFound: 'links will be changed',
    markTask: 'Mark task',
    unmarkTask: 'Unmark task',
    readingView: 'Reading',
    modeEdit: 'Edit',
    modeReading: 'Reading',
    modeSplit: 'Split',
    editorModeMenu: 'Note options',
    collapseToolbar: 'Collapse formatting toolbar',
    expandToolbar: 'Show formatting toolbar',
    editorPosition: 'Document position',
    line: 'Line',
    column: 'Column',
    selectedOne: 'selected',
    selectedMany: 'selected',
    linkRedirectTitle: 'Open external link?',
    linkRedirectDescription: 'You’ll be redirected to:',
    linkDestination: 'Destination',
    openLink: 'Open',
    linkOpenFailed: 'The link could not be opened.',
    dismissNotice: 'Dismiss notification',
    notifications: 'Notifications',
    saving: 'Saving…',
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saveFailed: 'The note could not be saved.',
    conflictTitle: 'This note changed outside Flyoff',
    conflictDescription:
      'Reload the version on disk or overwrite the external change.',
    reloadFromDisk: 'Reload from disk',
    overwrite: 'Overwrite',
    overviewDescription: 'Organize this den’s folders and notes from the sidebar.',
    unavailable: 'This content is no longer available.',
    projectUnavailable: 'The den from the previous session could not be opened.',
  },
  pages: {
    bar: 'Pages',
    navigation: 'Navigation',
    home: 'Home',
    thisDevice: 'This Device',
    settings: 'Settings',
    help: 'Help',
    updateApp: 'Update application',
    newTab: 'New tab',
    nothingOpenYet: 'Nothing open yet',
    search: 'Search',
    searchDen: 'Search this den',
    searchResults: 'Search results',
    frequentNotes: 'Frequently opened',
    recentlyClosed: 'Recently closed',
    noFrequentNotes: 'Your most visited notes will appear here.',
    noRecentlyClosed: 'No recently closed notes.',
    closeAllTabs: 'Close all tabs',
    paneMenu: 'Pane actions',
    tabMenu: 'Tab actions',
    splitRight: 'Split right',
    splitBelow: 'Split below',
    openInPane: 'Open in this pane',
    closePane: 'Close pane',
    resizePane: 'Resize panes',
    closeTab: 'Close tab',
    failed: 'This page could not be displayed.',
  },
  sessionRestore: {
    message: 'Restore tabs from your last session?',
    restore: 'Restore',
    ignore: 'Ignore',
  },
  closeConfirmation: {
    closeWindowTitle: 'Close this window?',
    quitTitle: 'Quit Flyoff?',
    restartTitle: 'Restart Flyoff?',
    description: 'You can restore your open pages next session.',
    cancel: 'Cancel',
    closeWindow: 'Close window',
    quit: 'Quit',
    restart: 'Restart',
  },
  errors: {
    nativeCoreStartupTitle: 'Flyoff could not start',
    nativeCoreStartupMessage: 'The application core could not be started.',
    nativeCoreStoppedTitle: 'Flyoff was interrupted',
    nativeCoreStoppedMessage:
      'The application core stopped unexpectedly.',
  },
} as const satisfies TranslationCatalog;

export const TRANSLATION_CATALOGS = {
  'pt-BR': ptBR,
  'en-US': enUS,
} as const satisfies Record<UiLocale, TranslationCatalog>;

export const I18NEXT_RESOURCES = {
  'pt-BR': { translation: ptBR },
  'en-US': { translation: enUS },
} as const;
