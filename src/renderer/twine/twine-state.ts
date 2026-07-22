import type { PageSessionState } from '../../shared/contracts';
import {
  DEFAULT_TWINE_MODEL_ID,
  isTwineModelId,
  type TwineModelId,
} from './twine-models';

export type TwineThinkingLevel = 'low' | 'high';
export type TwineApprovalMode = 'request' | 'automatic' | 'full';

export interface TwinePageState extends PageSessionState {
  version: 1;
  data: {
    activeConversationId: string | null;
    modelId: TwineModelId;
    approvalMode: TwineApprovalMode;
    researchEnabled: boolean;
    thinkingLevel: TwineThinkingLevel;
  };
}

export function createTwinePageState(): TwinePageState {
  return {
    version: 1,
    data: {
      activeConversationId: null,
      modelId: DEFAULT_TWINE_MODEL_ID,
      approvalMode: 'request',
      researchEnabled: false,
      thinkingLevel: 'high',
    },
  };
}

function normalizeApprovalMode(value: unknown): TwineApprovalMode {
  return value === 'automatic' || value === 'full' ? value : 'request';
}

function normalizeConversationId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function migrateTwinePageState(
  state: PageSessionState,
): TwinePageState {
  if (state.version !== 1 || !isRecord(state.data)) {
    return createTwinePageState();
  }

  return {
    version: 1,
    data: {
      activeConversationId: normalizeConversationId(
        state.data.activeConversationId,
      ),
      modelId: isTwineModelId(state.data.modelId)
        ? state.data.modelId
        : DEFAULT_TWINE_MODEL_ID,
      approvalMode: normalizeApprovalMode(state.data.approvalMode),
      researchEnabled:
        typeof state.data.researchEnabled === 'boolean'
          ? state.data.researchEnabled
          : false,
      thinkingLevel:
        state.data.thinkingLevel === 'low' ? 'low' : 'high',
    },
  };
}
