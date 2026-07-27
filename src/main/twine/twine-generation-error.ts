import type { TwineGenerationErrorCode } from '../../shared/contracts';

function errorText(error: unknown, depth = 0, seen = new Set<object>()): string {
  if (depth > 4 || error === null || error === undefined) {
    return '';
  }
  if (
    typeof error === 'string' ||
    typeof error === 'number' ||
    typeof error === 'boolean'
  ) {
    return String(error);
  }
  if (typeof error !== 'object' || seen.has(error)) {
    return '';
  }

  seen.add(error);
  const record = error as Record<string, unknown>;
  return [
    error instanceof Error ? error.name : '',
    error instanceof Error ? error.message : '',
    errorText(record.code, depth + 1, seen),
    errorText(record.status, depth + 1, seen),
    errorText(record.message, depth + 1, seen),
    errorText(record.error, depth + 1, seen),
    errorText(record.cause, depth + 1, seen),
  ]
    .filter(Boolean)
    .join(' ');
}

export function classifyTwineGenerationError(
  error: unknown,
): TwineGenerationErrorCode {
  const text = errorText(error).toLowerCase();

  if (
    /api[_ -]?key|api_key_invalid|unauthenticated|authentication|credential|permission_denied/.test(
      text,
    ) ||
    /\b401\b/.test(text)
  ) {
    return 'authentication';
  }
  if (
    /\b429\b|resource_exhausted|rate[ -]?limit|quota (?:has been )?exceeded|too many requests/.test(
      text,
    )
  ) {
    return 'rate-limited';
  }
  if (
    /\b503\b|\bunavailable\b|service unavailable|high demand|overload|temporarily unavailable/.test(
      text,
    )
  ) {
    return 'overloaded';
  }
  if (
    /network|fetch failed|econn(?:reset|refused|aborted)|enotfound|etimedout|socket|dns|timed? out/.test(
      text,
    )
  ) {
    return 'network';
  }
  return 'unknown';
}
