import type { ComponentType } from 'react';

import configurationIcon from '../../../public/images/icons/homepage/configuration.svg';
import helpIcon from '../../../public/images/icons/homepage/help.svg';
import homeIcon from '../../../public/images/icons/homepage/home.svg';
import thisDeviceIcon from '../../../public/images/icons/homepage/this-device.svg';
import updateIcon from '../../../public/images/icons/homepage/update-app.svg';
import {
  INTERNAL_PAGE_IDS,
  type InternalPageId,
  type PageSessionState,
} from '../../shared/contracts';
import type { TranslationKey } from '../../shared/i18n';
import { HomePage } from './HomePage';
import type { InternalPageProps } from './page-types';
import { PlaceholderPage } from './PlaceholderPage';

export interface InternalPageDefinition {
  id: InternalPageId;
  titleKey: TranslationKey;
  icon: string;
  singleton: boolean;
  retention: 'keep-alive';
  stateVersion: number;
  component: ComponentType<InternalPageProps>;
  createInitialState: () => PageSessionState;
  migrateState: (state: PageSessionState) => PageSessionState;
}

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
    icon: homeIcon,
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
    icon: thisDeviceIcon,
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
    component: PlaceholderPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
  [INTERNAL_PAGE_IDS.help]: {
    id: INTERNAL_PAGE_IDS.help,
    titleKey: 'pages.help',
    icon: helpIcon,
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
    icon: updateIcon,
    singleton: true,
    retention: 'keep-alive',
    stateVersion: 1,
    component: PlaceholderPage,
    createInitialState: createEmptyState,
    migrateState: migrateEmptyState,
  },
} as const satisfies Record<InternalPageId, InternalPageDefinition>;

export const PAGE_NAVIGATION_ORDER = [
  INTERNAL_PAGE_IDS.home,
  INTERNAL_PAGE_IDS.thisDevice,
  INTERNAL_PAGE_IDS.settings,
  INTERNAL_PAGE_IDS.help,
  INTERNAL_PAGE_IDS.updateApp,
] as const satisfies readonly InternalPageId[];

export function getPageDefinition(
  pageId: InternalPageId,
): InternalPageDefinition {
  return PAGE_REGISTRY[pageId];
}
