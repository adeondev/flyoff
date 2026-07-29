import type { PageSessionState } from '../../shared/contracts';
import {
  DEFAULT_TWINE_MODEL_ID,
  isTwineModelId,
  type TwineModelId,
} from './twine-models';

export type TwineThinkingLevel = 'low' | 'high';
export type TwineApprovalMode = 'request' | 'automatic' | 'full';
export type TwineDocumentContextScope = 'current' | 'project';

export interface TwinePageState extends PageSessionState {
  version: 3;
  data: {
    activeConversationId: string | null;
    modelId: TwineModelId;
    approvalMode: TwineApprovalMode;
    documentContextEnabled: boolean;
    documentContextScope: TwineDocumentContextScope;
    researchEnabled: boolean;
    thinkingLevel: TwineThinkingLevel;
  };
}

export function createTwinePageState(): TwinePageState {
  return {
    version: 3,
    data: {
      activeConversationId: null,
      modelId: DEFAULT_TWINE_MODEL_ID,
      approvalMode: 'request',
      documentContextEnabled: false,
      documentContextScope: 'current',
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
  if (
    (state.version !== 1 &&
      state.version !== 2 &&
      state.version !== 3) ||
    !isRecord(state.data)
  ) {
    return createTwinePageState();
  }

  return {
    version: 3,
    data: {
      activeConversationId: normalizeConversationId(
        state.data.activeConversationId,
      ),
      modelId: isTwineModelId(state.data.modelId)
        ? state.data.modelId
        : DEFAULT_TWINE_MODEL_ID,
      approvalMode: normalizeApprovalMode(state.data.approvalMode),
      documentContextEnabled:
        state.version === 3 &&
        typeof state.data.documentContextEnabled === 'boolean'
          ? state.data.documentContextEnabled
          : state.version === 2 &&
              typeof state.data.diagramContextEnabled === 'boolean'
            ? state.data.diagramContextEnabled
            : false,
      documentContextScope:
        (state.version === 3 &&
          state.data.documentContextScope === 'project') ||
        (state.version === 2 &&
          state.data.diagramContextScope === 'project')
          ? 'project'
          : 'current',
      researchEnabled:
        typeof state.data.researchEnabled === 'boolean'
          ? state.data.researchEnabled
          : false,
      thinkingLevel:
        state.data.thinkingLevel === 'low' ? 'low' : 'high',
    },
  };
}
