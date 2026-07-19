import { createElement, type ComponentType, type ReactNode } from 'react';

import flyoffLogo from '../../../public/images/flyoff/flyoff-logo.svg';
import configurationIcon from '../../../public/images/icons/homepage/configuration.svg';
import folderOpenIcon from '../../../public/images/icons/instances/folder-open.svg';
import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import plusIcon from '../../../public/images/icons/actions/plus.svg';
import documentationIcon from '../../../public/images/icons/site/documentation.svg';
import {
  createEditorModeState,
  readEditorMode,
} from '../projects/editor-mode';
import {
  INTERNAL_PAGE_IDS,
  type InternalPageId,
  type PageSessionState,
  type TabDescriptor,
  type TabTarget,
} from '../../shared/contracts';
import type { TranslationKey } from '../../shared/i18n';
import { HomePage } from './HomePage';
import { NewTabPage } from './NewTabPage';
import type {
  InternalPageProps,
  PageRenderProps,
  PageRetention,
} from './page-types';
import { PlaceholderPage } from './PlaceholderPage';
import { SettingsPage } from './SettingsPage';

export interface InternalPageDefinition {
  id: InternalPageId;
  titleKey: TranslationKey;
  icon: string;
  singleton: boolean;
  retention: PageRetention;
  stateVersion: number;
  component: ComponentType<InternalPageProps>;
  createInitialState: () => PageSessionState;
  migrateState: (state: PageSessionState) => PageSessionState;
  availableInProject?: boolean;
}

export interface ProjectPageDefinition {
  targetType: 'project-overview' | 'project-content';
  retention: PageRetention;
  stateVersion: number;
  createInitialState: () => PageSessionState;
  migrateState: (state: PageSessionState) => PageSessionState;
}

export type TabTargetPageDefinition =
  | InternalPageDefinition
  | ProjectPageDefinition;

function createEmptyState(): PageSessionState {
  return { version: 1, data: {} };
}

function migrateEmptyState(state: PageSessionState): PageSessionState {
  return state.version === 1 && isRecord(state.data)
    ? state
    : createEmptyState();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const PAGE_REGISTRY = {
  [INTERNAL_PAGE_IDS.home]: {
    id: INTERNAL_PAGE_IDS.home,
    titleKey: 'pages.home',
    icon: flyoffLogo,
    singleton: true,
    retention: 'keep-alive',
    stateVersion: 1,
    component: HomePage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
  [INTERNAL_PAGE_IDS.thisDevice]: {
    id: INTERNAL_PAGE_IDS.thisDevice,
    titleKey: 'pages.thisDevice',
    icon: folderOpenIcon,
    singleton: true,
    retention: 'keep-alive',
    stateVersion: 1,
    component: PlaceholderPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
  [INTERNAL_PAGE_IDS.settings]: {
    id: INTERNAL_PAGE_IDS.settings,
    titleKey: 'pages.settings',
    icon: configurationIcon,
    singleton: true,
    retention: 'keep-alive',
    stateVersion: 1,
    component: SettingsPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
    availableInProject: true,
  },
  [INTERNAL_PAGE_IDS.help]: {
    id: INTERNAL_PAGE_IDS.help,
    titleKey: 'pages.help',
    icon: documentationIcon,
    singleton: true,
    retention: 'keep-alive',
    stateVersion: 1,
    component: PlaceholderPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
  [INTERNAL_PAGE_IDS.updateApp]: {
    id: INTERNAL_PAGE_IDS.updateApp,
    titleKey: 'pages.updateApp',
    icon: refreshIcon,
    singleton: true,
    retention: 'keep-alive',
    stateVersion: 1,
    component: PlaceholderPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
  [INTERNAL_PAGE_IDS.newTab]: {
    id: INTERNAL_PAGE_IDS.newTab,
    titleKey: 'pages.newTab',
    icon: plusIcon,
    singleton: false,
    retention: 'active-only',
    stateVersion: 1,
    component: NewTabPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
    availableInProject: true,
  },
} as const satisfies Record<InternalPageId, InternalPageDefinition>;

export const PAGE_NAVIGATION_ORDER = [
  INTERNAL_PAGE_IDS.home,
  INTERNAL_PAGE_IDS.thisDevice,
  INTERNAL_PAGE_IDS.settings,
  INTERNAL_PAGE_IDS.help,
  INTERNAL_PAGE_IDS.updateApp,
] as const satisfies readonly InternalPageId[];

export const PROJECT_PAGE_REGISTRY = {
  'project-overview': {
    targetType: 'project-overview',
    retention: 'keep-alive',
    stateVersion: 1,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
  'project-content': {
    targetType: 'project-content',
    retention: 'active-only',
    stateVersion: 3,
    createInitialState: () => createEditorModeState('edit'),
    migrateState: (state) => createEditorModeState(readEditorMode(state)),
  },
} as const satisfies Record<
  'project-overview' | 'project-content',
  ProjectPageDefinition
>;

export function getPageDefinition(
  pageId: InternalPageId,
): InternalPageDefinition {
  return PAGE_REGISTRY[pageId];
}

export function getTabTargetPageDefinition(
  target: TabTarget,
): TabTargetPageDefinition {
  return target.type === 'internal'
    ? getPageDefinition(target.pageId)
    : PROJECT_PAGE_REGISTRY[target.type];
}

export function getPageRetention(target: TabTarget): PageRetention {
  return getTabTargetPageDefinition(target).retention;
}

export function renderRegisteredInternalPage(
  props: PageRenderProps,
): ReactNode {
  if (props.descriptor.target.type !== 'internal') {
    throw new TypeError('Expected an internal page target.');
  }

  const definition = getPageDefinition(props.descriptor.target.pageId);
  const PageComponent = definition.component;

  return createElement(PageComponent, {
    ...props,
    icon: definition.icon,
    descriptor: props.descriptor as TabDescriptor & {
      target: { type: 'internal'; pageId: InternalPageId };
    },
  });
}
