export const OPEN_EXTERNAL_LINK_CHANNEL = 'flyoff:links:open-external' as const;

export interface OpenExternalLinkRequest {
  url: string;
}

export type OpenExternalLinkError =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'open-failed';

export type OpenExternalLinkResult =
  | { ok: true }
  | { ok: false; error: OpenExternalLinkError };

export function isOpenExternalLinkRequest(
  value: unknown,
): value is OpenExternalLinkRequest {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).url === 'string' &&
    ((value as Record<string, unknown>).url as string).length > 0 &&
    ((value as Record<string, unknown>).url as string).length <= 4_096
  );
}

export function isOpenExternalLinkResult(
  value: unknown,
): value is OpenExternalLinkResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const result = value as Record<string, unknown>;
  return result.ok === true || (
    result.ok === false &&
    ['invalid-url', 'unsupported-scheme', 'open-failed'].includes(
      result.error as string,
    )
  );
}
