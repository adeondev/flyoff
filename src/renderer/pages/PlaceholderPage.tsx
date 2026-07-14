import type { InternalPageProps } from './page-types';

export function PlaceholderPage({ title }: InternalPageProps) {
  return (
    <main className="placeholder-page">
      <h1>{title}</h1>
    </main>
  );
}
