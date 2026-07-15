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
  projects: {
    navigation: string;
    overview: string;
    closeProject: string;
    emptyWorkspace: string;
    refresh: string;
    add: string;
    moreActions: string;
    newNote: string;
    newFolder: string;
    rename: string;
    move: string;
    moveTo: string;
    trash: string;
    empty: string;
    loading: string;
    loadFailed: string;
    operationFailed: string;
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
    description: string;
    cancel: string;
    closeWindow: string;
    quit: string;
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
  },
  home: {
    prompt: 'O que vai fazer hoje?',
    newProject: 'Novo Projeto',
    importProject: 'Importar Projeto',
    openProject: 'Abrir Projeto',
    templates: 'Modelos',
    dragFiles: 'Ou arraste arquivos aqui',
    navigationHome: 'Início',
    navigation: 'Navegação',
    thisDevice: 'Este Dispositivo',
    settings: 'Configurações',
    update: 'Atualizar',
  },
  projects: {
    navigation: 'Conteúdo do projeto',
    overview: 'Visão geral',
    closeProject: 'Fechar projeto',
    emptyWorkspace: 'Nenhuma aba aberta.',
    refresh: 'Atualizar',
    add: 'Adicionar',
    moreActions: 'Mais ações',
    newNote: 'Nova nota',
    newFolder: 'Nova pasta',
    rename: 'Renomear',
    move: 'Mover',
    moveTo: 'Mover para…',
    trash: 'Mover para a lixeira',
    empty: 'Esta pasta está vazia.',
    loading: 'Carregando…',
    loadFailed: 'Não foi possível carregar esta pasta.',
    operationFailed: 'Não foi possível concluir a operação.',
    invalidName:
      'Use de 1 a 100 caracteres e evite separadores, controles, ponto ou espaço no final e nomes reservados.',
    projectName: 'Nome do projeto',
    location: 'Local',
    chooseLocation: 'Escolher local',
    locationNotSelected: 'Escolha onde o projeto será criado.',
    createProject: 'Criar projeto',
    creatingProject: 'Criando projeto…',
    cancel: 'Cancelar',
    create: 'Criar',
    save: 'Salvar',
    deleteTitle: 'Mover para a lixeira?',
    deleteFolderDescription:
      'A pasta e todo o conteúdo dentro dela, incluindo arquivos ocultos pelo Flyoff, serão movidos para a lixeira.',
    deletePageDescription: 'A nota será movida para a lixeira.',
    delete: 'Mover para a lixeira',
    rootFolder: 'Raiz do projeto',
    selectDestination: 'Escolha a pasta de destino.',
    moveTitle: 'Mover item',
    moving: 'Movendo…',
    name: 'Nome',
    markdownExtension: 'Extensão Markdown',
    editorLabel: 'Editor Markdown',
    saving: 'Salvando…',
    saved: 'Salvo',
    unsaved: 'Alterações não salvas',
    saveFailed: 'Não foi possível salvar a nota.',
    conflictTitle: 'A nota foi alterada fora do Flyoff',
    conflictDescription:
      'Recarregue a versão do disco ou sobrescreva a alteração externa.',
    reloadFromDisk: 'Recarregar do disco',
    overwrite: 'Sobrescrever',
    overviewDescription: 'Organize as pastas e notas deste projeto pela sidebar.',
    unavailable: 'Este conteúdo não está mais disponível.',
    projectUnavailable: 'O projeto da sessão anterior não pôde ser aberto.',
  },
  pages: {
    bar: 'Páginas',
    navigation: 'Navegação',
    home: 'Início',
    thisDevice: 'Este dispositivo',
    settings: 'Configurações',
    help: 'Ajuda',
    updateApp: 'Atualizar aplicativo',
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
    description:
      'Você poderá restaurar as páginas abertas na próxima sessão.',
    cancel: 'Cancelar',
    closeWindow: 'Fechar janela',
    quit: 'Sair',
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
  },
  home: {
    prompt: 'What would you like to do today?',
    newProject: 'New Project',
    importProject: 'Import Project',
    openProject: 'Open Project',
    templates: 'Templates',
    dragFiles: 'Or drag files here',
    navigationHome: 'Home',
    navigation: 'Navigation',
    thisDevice: 'This Device',
    settings: 'Settings',
    update: 'Update',
  },
  projects: {
    navigation: 'Project contents',
    overview: 'Overview',
    closeProject: 'Close project',
    emptyWorkspace: 'No tab open.',
    refresh: 'Refresh',
    add: 'Add',
    moreActions: 'More actions',
    newNote: 'New note',
    newFolder: 'New folder',
    rename: 'Rename',
    move: 'Move',
    moveTo: 'Move to…',
    trash: 'Move to trash',
    empty: 'This folder is empty.',
    loading: 'Loading…',
    loadFailed: 'This folder could not be loaded.',
    operationFailed: 'The operation could not be completed.',
    invalidName:
      'Use 1 to 100 characters and avoid separators, controls, trailing dots or spaces, and reserved names.',
    projectName: 'Project name',
    location: 'Location',
    chooseLocation: 'Choose location',
    locationNotSelected: 'Choose where the project will be created.',
    createProject: 'Create project',
    creatingProject: 'Creating project…',
    cancel: 'Cancel',
    create: 'Create',
    save: 'Save',
    deleteTitle: 'Move to trash?',
    deleteFolderDescription:
      'The folder and everything inside it, including files hidden by Flyoff, will be moved to the trash.',
    deletePageDescription: 'The note will be moved to the trash.',
    delete: 'Move to trash',
    rootFolder: 'Project root',
    selectDestination: 'Choose the destination folder.',
    moveTitle: 'Move item',
    moving: 'Moving…',
    name: 'Name',
    markdownExtension: 'Markdown extension',
    editorLabel: 'Markdown editor',
    saving: 'Saving…',
    saved: 'Saved',
    unsaved: 'Unsaved changes',
    saveFailed: 'The note could not be saved.',
    conflictTitle: 'This note changed outside Flyoff',
    conflictDescription:
      'Reload the version on disk or overwrite the external change.',
    reloadFromDisk: 'Reload from disk',
    overwrite: 'Overwrite',
    overviewDescription: 'Organize this project’s folders and notes from the sidebar.',
    unavailable: 'This content is no longer available.',
    projectUnavailable: 'The project from the previous session could not be opened.',
  },
  pages: {
    bar: 'Pages',
    navigation: 'Navigation',
    home: 'Home',
    thisDevice: 'This Device',
    settings: 'Settings',
    help: 'Help',
    updateApp: 'Update application',
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
    description: 'You can restore your open pages next session.',
    cancel: 'Cancel',
    closeWindow: 'Close window',
    quit: 'Quit',
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
