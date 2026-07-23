import { TwineChat } from '../twine';
import type { InternalPageProps } from './page-types';

export function TwinePage(props: InternalPageProps) {
  return <TwineChat {...props} />;
}
