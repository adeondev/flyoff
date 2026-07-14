export const NATIVE_CORE_PROTOCOL_VERSION = 1 as const;

export interface NativeCoreHealth {
  coreVersion: string;
  protocolVersion: number;
}

export const NATIVE_CORE_ERROR_CODES = [
  'LOAD_FAILED',
  'INVALID_HEALTH_RESPONSE',
  'PROTOCOL_MISMATCH',
  'UNKNOWN',
] as const;

export type NativeCoreErrorCode = (typeof NATIVE_CORE_ERROR_CODES)[number];

export interface NativeCoreError {
  code: NativeCoreErrorCode;
  message: string;
}

export interface NativeCoreReadyMessage {
  type: 'native-core:ready';
  payload: NativeCoreHealth;
}

export interface NativeCoreErrorMessage {
  type: 'native-core:error';
  payload: NativeCoreError;
}

export type NativeCoreMessage =
  | NativeCoreReadyMessage
  | NativeCoreErrorMessage;

export function isNativeCoreHealth(value: unknown): value is NativeCoreHealth {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const health = value as Record<string, unknown>;

  return (
    typeof health.coreVersion === 'string' &&
    health.coreVersion.length > 0 &&
    typeof health.protocolVersion === 'number' &&
    Number.isInteger(health.protocolVersion) &&
    health.protocolVersion > 0
  );
}

export function isNativeCoreMessage(value: unknown): value is NativeCoreMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Record<string, unknown>;

  if (message.type === 'native-core:ready') {
    return isNativeCoreHealth(message.payload);
  }

  if (message.type !== 'native-core:error') {
    return false;
  }

  if (!message.payload || typeof message.payload !== 'object') {
    return false;
  }

  const error = message.payload as Record<string, unknown>;

  return (
    typeof error.code === 'string' &&
    (NATIVE_CORE_ERROR_CODES as readonly string[]).includes(error.code) &&
    typeof error.message === 'string' &&
    error.message.length > 0
  );
}
