import {
  isTabSessionSnapshot,
  type TabSessionSnapshot,
} from './tab-session';

export const CLOSE_REQUESTED_CHANNEL = 'flyoff:window:close-requested' as const;
export const CLOSE_RESPONSE_CHANNEL = 'flyoff:window:close-response' as const;

export type CloseIntent = 'close-window' | 'quit-application';

export interface CloseRequest {
  requestId: string;
  intent: CloseIntent;
}

export type CloseResponse =
  | {
      requestId: string;
      decision: 'cancel';
    }
  | {
      requestId: string;
      decision: 'confirm';
      session: TabSessionSnapshot;
    };

export function isCloseRequest(value: unknown): value is CloseRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const request = value as Record<string, unknown>;

  return (
    typeof request.requestId === 'string' &&
    request.requestId.length > 0 &&
    request.requestId.length <= 128 &&
    (request.intent === 'close-window' ||
      request.intent === 'quit-application')
  );
}

export function isCloseResponse(value: unknown): value is CloseResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;

  if (
    typeof response.requestId !== 'string' ||
    response.requestId.length === 0 ||
    response.requestId.length > 128
  ) {
    return false;
  }

  return response.decision === 'cancel'
    ? response.session === undefined
    : response.decision === 'confirm' && isTabSessionSnapshot(response.session);
}
