import {
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';

import type { ProjectMediaAsset } from '../../shared/contracts';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';

interface MediaImageViewerProps {
  asset: ProjectMediaAsset;
  source: string;
  translate: Translate;
}

interface Point {
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.min(8, Math.max(0.1, value));
}

export function MediaImageViewer({
  asset,
  source,
  translate,
}: MediaImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const sessionRef = useRef<
    | {
        pointerId: number;
        start: Point;
        initial: Point;
      }
    | undefined
  >(undefined);

  const reset = (): void => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const changeZoom = (next: number): void => {
    const normalized = clampZoom(next);
    setZoom(normalized);
    if (normalized <= 1) {
      setPan({ x: 0, y: 0 });
    }
  };

  const beginPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || zoom <= 1) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      initial: pan,
    };
  };

  const movePan = (event: PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    setPan({
      x: session.initial.x + event.clientX - session.start.x,
      y: session.initial.y + event.clientY - session.start.y,
    });
  };

  const endPan = (event: PointerEvent<HTMLDivElement>): void => {
    if (sessionRef.current?.pointerId !== event.pointerId) {
      return;
    }
    sessionRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const wheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    changeZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  };

  return (
    <div className="project-media-image-viewer">
      <div className="project-media-image-viewer__controls">
        <button
          aria-label={translate('menu.zoomOut')}
          onClick={() => changeZoom(zoom / 1.25)}
          type="button"
          {...getTooltipTargetProps(translate('menu.zoomOut'), 'bottom')}
        >
          −
        </button>
        <button
          aria-label={translate('menu.resetZoom')}
          onClick={reset}
          type="button"
          {...getTooltipTargetProps(translate('menu.resetZoom'), 'bottom')}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label={translate('menu.zoomIn')}
          onClick={() => changeZoom(zoom * 1.25)}
          type="button"
          {...getTooltipTargetProps(translate('menu.zoomIn'), 'bottom')}
        >
          +
        </button>
      </div>
      <div
        className="project-media-image-viewer__stage"
        data-pannable={zoom > 1 || undefined}
        onLostPointerCapture={endPan}
        onPointerCancel={endPan}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onWheel={wheel}
      >
        <img
          alt={asset.name}
          draggable={false}
          src={source}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        />
      </div>
    </div>
  );
}
