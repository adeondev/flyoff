import type { ReactNode } from 'react';

import type {
  InternalTabTarget,
  PageSessionState,
  TabDescriptor,
} from '../../shared/contracts';
import type { TranslationKey } from '../../shared/i18n';

export type Translate = (key: TranslationKey) => string;

export type PageRetention = 'keep-alive' | 'active-only';

export interface TabPresentation {
  title: string;
  icon: string;
}

export interface PageRenderProps {
  descriptor: TabDescriptor;
  title: string;
  translate: Translate;
  onStateChange: (state: PageSessionState) => void;
  onScrollChange: (scrollTop: number) => void;
}

export interface InternalPageProps extends PageRenderProps {
  descriptor: TabDescriptor & { target: InternalTabTarget };
  icon?: string;
}

export type PageRenderer = (props: PageRenderProps) => ReactNode;
