import type { TwineGenerationActivity } from '../../shared/contracts';

interface TwineThinkingIndicatorProps {
  activity: TwineGenerationActivity;
}

export function TwineThinkingIndicator({
  activity,
}: TwineThinkingIndicatorProps) {
  return (
    <svg
      aria-hidden="true"
      className="twine-thinking-indicator"
      data-activity={activity}
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path
        className="twine-thinking-indicator__thread twine-thinking-indicator__thread--first"
        d="M2.5 10c0-2.3 1.5-3.9 3.6-3.9 3.9 0 4 7.8 7.8 7.8 2.1 0 3.6-1.6 3.6-3.9"
        pathLength="1"
      />
      <path
        className="twine-thinking-indicator__thread twine-thinking-indicator__thread--second"
        d="M17.5 10c0-2.3-1.5-3.9-3.6-3.9-3.9 0-4 7.8-7.8 7.8-2.1 0-3.6-1.6-3.6-3.9"
        pathLength="1"
      />
      {activity === 'searching' ? (
        <circle
          className="twine-thinking-indicator__orbit"
          cx="10"
          cy="2.25"
          r="1.15"
        />
      ) : null}
    </svg>
  );
}
