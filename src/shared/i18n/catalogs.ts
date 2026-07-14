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
  home: {
    prompt: string;
    newProject: string;
    importProject: string;
    templates: string;
    dragFiles: string;
    navigationHome: string;
    navigation: string;
    thisDevice: string;
    settings: string;
    update: string;
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
  home: {
    prompt: 'O que vai fazer hoje?',
    newProject: 'Novo Projeto',
    importProject: 'Importar Projeto',
    templates: 'Modelos',
    dragFiles: 'Ou arraste arquivos aqui',
    navigationHome: 'Início',
    navigation: 'Navegação',
    thisDevice: 'Este Dispositivo',
    settings: 'Configurações',
    update: 'Atualizar',
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
  home: {
    prompt: 'What would you like to do today?',
    newProject: 'New Project',
    importProject: 'Import Project',
    templates: 'Templates',
    dragFiles: 'Or drag files here',
    navigationHome: 'Home',
    navigation: 'Navigation',
    thisDevice: 'This Device',
    settings: 'Settings',
    update: 'Update',
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
