import type {
  PageSessionState,
  TabDescriptor,
} from '../../shared/contracts';
import type { TranslationKey } from '../../shared/i18n';

export type Translate = (key: TranslationKey) => string;

export interface InternalPageProps {
  descriptor: TabDescriptor;
  title: string;
  translate: Translate;
  onStateChange: (state: PageSessionState) => void;
}
