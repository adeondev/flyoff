import type { DiagramElement } from '../../../shared/diagram';

export type DiagramToolIconKind =
  | DiagramElement['kind']
  | 'select'
  | 'connect'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-view'
  | 'view-options'
  | 'file-actions'
  | 'chevron-down';

interface DiagramToolIconProps {
  kind: DiagramToolIconKind;
}

function iconContent(kind: DiagramToolIconKind) {
  switch (kind) {
    case 'select':
      return <path d="m5 3 9 8-4 .7 2.2 4-2 1.1-2.1-4L5 15Z" />;
    case 'package':
      return <path d="M2.5 6.5h5l1.5-2h8.5v11h-15Z" />;
    case 'class':
      return (
        <>
          <rect height="14" rx="1" width="15" x="2.5" y="3" />
          <path d="M2.5 7.5h15M2.5 12h15" />
        </>
      );
    case 'interface':
      return (
        <>
          <circle cx="10" cy="6" r="3" />
          <path d="M10 9v7M6 16h8" />
        </>
      );
    case 'enumeration':
      return (
        <>
          <rect height="14" rx="1" width="15" x="2.5" y="3" />
          <path d="M2.5 7.5h15M6.5 11h7M6.5 14h5" />
          <circle cx="4.5" cy="11" r=".5" />
          <circle cx="4.5" cy="14" r=".5" />
        </>
      );
    case 'actor':
      return (
        <>
          <circle cx="10" cy="4.5" r="2.2" />
          <path d="M10 6.7v5M6 9h8M10 11.7 6.8 17M10 11.7l3.2 5.3" />
        </>
      );
    case 'use-case':
      return <ellipse cx="10" cy="10" rx="7.5" ry="4.7" />;
    case 'system-boundary':
      return (
        <>
          <rect height="15" rx="1" width="16" x="2" y="2.5" />
          <ellipse cx="10" cy="10" rx="5" ry="3" />
        </>
      );
    case 'lifeline':
      return (
        <>
          <rect height="4.5" rx=".7" width="11" x="4.5" y="2.5" />
          <path d="M10 7v10" strokeDasharray="2 2" />
        </>
      );
    case 'activation':
      return (
        <>
          <path d="M10 2v16" strokeDasharray="2 2" />
          <rect height="9" width="3" x="8.5" y="6" />
        </>
      );
    case 'activity-partition':
      return (
        <>
          <rect height="15" rx="1" width="15" x="2.5" y="2.5" />
          <path d="M7.5 2.5v15M12.5 2.5v15" />
        </>
      );
    case 'action':
      return <rect height="9" rx="3" width="15" x="2.5" y="5.5" />;
    case 'object-node':
      return (
        <>
          <rect height="9" width="14" x="3" y="4" />
          <path d="M5 15.5h10" />
        </>
      );
    case 'initial-node':
      return <circle className="diagram-tool-icon__fill" cx="10" cy="10" r="5" />;
    case 'activity-final':
      return (
        <>
          <circle cx="10" cy="10" r="7" />
          <circle className="diagram-tool-icon__fill" cx="10" cy="10" r="4" />
        </>
      );
    case 'flow-final':
      return (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="m6.5 6.5 7 7m0-7-7 7" />
        </>
      );
    case 'decision':
      return <path d="m10 2.8 7.2 7.2-7.2 7.2L2.8 10Z" />;
    case 'merge':
      return (
        <>
          <path d="m10 2.8 7.2 7.2-7.2 7.2L2.8 10Z" />
          <path d="M5.7 10h8.6" />
        </>
      );
    case 'fork':
      return (
        <>
          <path d="M3 7h14" />
          <path d="M10 3v4M6 7v10m8-10v10" />
        </>
      );
    case 'join':
      return (
        <>
          <path d="M3 13h14" />
          <path d="M6 3v10m8-10v10m-4 0v4" />
        </>
      );
    case 'connect':
      return (
        <>
          <circle cx="4" cy="14.5" r="2" />
          <circle cx="16" cy="5.5" r="2" />
          <path d="m5.6 13.3 8.8-6.6" />
        </>
      );
    case 'undo':
      return <path d="M7 6H3v-4M3.5 6A7 7 0 1 1 5 15" />;
    case 'redo':
      return <path d="M13 6h4v-4m-.5 4A7 7 0 1 0 15 15" />;
    case 'zoom-in':
      return (
        <>
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m12.5 12.5 4.5 4.5M8.5 5.8v5.4M5.8 8.5h5.4" />
        </>
      );
    case 'zoom-out':
      return (
        <>
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m12.5 12.5 4.5 4.5M5.8 8.5h5.4" />
        </>
      );
    case 'fit-view':
      return <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 7h6v6H7Z" />;
    case 'view-options':
      return (
        <>
          <path d="M3 5h14M3 10h14M3 15h14" />
          <circle className="diagram-tool-icon__fill" cx="7" cy="5" r="1.5" />
          <circle className="diagram-tool-icon__fill" cx="13" cy="10" r="1.5" />
          <circle className="diagram-tool-icon__fill" cx="8.5" cy="15" r="1.5" />
        </>
      );
    case 'file-actions':
      return (
        <>
          <path d="M3 4.5h5l1.5 2H17v10.5H3Z" />
          <circle className="diagram-tool-icon__fill" cx="7" cy="12" r=".8" />
          <circle className="diagram-tool-icon__fill" cx="10" cy="12" r=".8" />
          <circle className="diagram-tool-icon__fill" cx="13" cy="12" r=".8" />
        </>
      );
    case 'chevron-down':
      return <path d="m5 7.5 5 5 5-5" />;
  }
}

export function DiagramToolIcon({ kind }: DiagramToolIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={`diagram-tool-icon diagram-tool-icon--${kind}`}
      fill="none"
      viewBox="0 0 20 20"
    >
      {iconContent(kind)}
    </svg>
  );
}
