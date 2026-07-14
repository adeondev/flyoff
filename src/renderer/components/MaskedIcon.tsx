import type { CSSProperties } from 'react';

interface MaskedIconProps {
  className?: string;
  icon: string;
}

export function MaskedIcon({ className = '', icon }: MaskedIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`home__icon${className ? ` ${className}` : ''}`}
      style={{ '--home-icon': `url("${icon}")` } as CSSProperties}
    />
  );
}
