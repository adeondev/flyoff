export interface PlaceholderPanelProps {
  title: string;
  hint: string;
}

export function PlaceholderPanel({ hint, title }: PlaceholderPanelProps) {
  return (
    <aside className="home__sidebar rail-placeholder" aria-label={title}>
      <div className="rail-placeholder__body">
        <p className="rail-placeholder__title">{title}</p>
        <p className="rail-placeholder__hint">{hint}</p>
      </div>
    </aside>
  );
}
