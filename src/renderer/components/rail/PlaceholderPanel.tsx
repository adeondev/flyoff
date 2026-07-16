import { MaskedIcon } from '../MaskedIcon';

export interface PlaceholderPanelProps {
  title: string;
  hint: string;
  icon: string;
}

export function PlaceholderPanel({ hint, icon, title }: PlaceholderPanelProps) {
  return (
    <aside className="home__sidebar rail-placeholder" aria-label={title}>
      <div className="rail-placeholder__body">
        <MaskedIcon className="rail-placeholder__icon" icon={icon} />
        <p className="rail-placeholder__title">{title}</p>
        <p className="rail-placeholder__hint">{hint}</p>
      </div>
    </aside>
  );
}
