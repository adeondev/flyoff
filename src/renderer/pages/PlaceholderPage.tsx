import type { InternalPageProps } from './page-types';
import { MaskedIcon } from '../components/MaskedIcon';

export function PlaceholderPage({ icon, title }: InternalPageProps) {
  return (
    <main className="placeholder-page">
      {icon ? <MaskedIcon className="placeholder-page__icon" icon={icon} /> : null}
      <h1>{title}</h1>
    </main>
  );
}
