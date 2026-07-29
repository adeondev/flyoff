import { TwineChat, type TwineDocumentAgent } from '../twine';
import type { InternalPageProps } from './page-types';

export interface TwinePageProps extends InternalPageProps {
  documentAgent?: TwineDocumentAgent;
}

export function TwinePage(props: TwinePageProps) {
  return <TwineChat {...props} />;
}
