export const TWINE_CREDENTIAL_STATUS_CHANNEL =
  'flyoff:twine:credentials:status' as const;
export const TWINE_SAVE_API_KEY_CHANNEL =
  'flyoff:twine:credentials:save' as const;
export const TWINE_REMOVE_API_KEY_CHANNEL =
  'flyoff:twine:credentials:remove' as const;
export const TWINE_START_GENERATION_CHANNEL =
  'flyoff:twine:generation:start' as const;
export const TWINE_CANCEL_GENERATION_CHANNEL =
  'flyoff:twine:generation:cancel' as const;
export const TWINE_GENERATION_EVENT_CHANNEL =
  'flyoff:twine:generation:event' as const;
export const TWINE_LIST_CONVERSATIONS_CHANNEL =
  'flyoff:twine:conversations:list' as const;
export const TWINE_LOAD_CONVERSATION_CHANNEL =
  'flyoff:twine:conversations:load' as const;
export const TWINE_SAVE_CONVERSATION_CHANNEL =
  'flyoff:twine:conversations:save' as const;
export const TWINE_CREATE_CONVERSATION_CHANNEL =
  'flyoff:twine:conversations:create' as const;
export const TWINE_DELETE_CONVERSATION_CHANNEL =
  'flyoff:twine:conversations:delete' as const;

export const TWINE_IPC_MODEL_IDS = [
  'google/gemma-4-31B-it',
  'google/gemma-4-26B-A4B-it',
] as const;
export const TWINE_THINKING_LEVELS = ['low', 'high'] as const;
export const TWINE_APPROVAL_MODES = [
  'request',
  'automatic',
  'full',
] as const;
export const TWINE_TOOL_TYPES = ['code', 'search'] as const;
export const TWINE_TOOL_PHASES = ['start', 'result'] as const;

export type TwineIpcModelId = (typeof TWINE_IPC_MODEL_IDS)[number];
export type TwineIpcThinkingLevel = (typeof TWINE_THINKING_LEVELS)[number];
export type TwineIpcApprovalMode = (typeof TWINE_APPROVAL_MODES)[number];
export type TwineToolType = (typeof TWINE_TOOL_TYPES)[number];
export type TwineToolPhase = (typeof TWINE_TOOL_PHASES)[number];

export interface TwineCredentialStatus {
  encryptionAvailable: boolean;
  hasApiKey: boolean;
}

export interface TwineGenerateMessage {
  role: 'assistant' | 'user';
  text: string;
}

export interface TwineGenerationRequest {
  approvalMode: TwineIpcApprovalMode;
  messages: readonly TwineGenerateMessage[];
  modelId: TwineIpcModelId;
  requestId: string;
  researchEnabled: boolean;
  thinkingLevel: TwineIpcThinkingLevel;
}

export interface TwineSource {
  title: string;
  url: string;
}

export interface TwineGenerationUsage {
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

export interface TwineConversationAttachmentSnapshot {
  id: string;
  name: string;
  size: number;
}

export interface TwineConversationToolActivity {
  id: string;
  phase: TwineToolPhase;
  text: string;
  tool: TwineToolType;
}

export interface TwineConversationMessageSnapshot {
  attachments: readonly TwineConversationAttachmentSnapshot[];
  id: string;
  kind: 'assistant' | 'system' | 'user';
  sources?: readonly TwineSource[];
  status: 'complete' | 'error';
  text: string;
  thinkingDurationMs?: number;
  thought?: string;
  tools?: readonly TwineConversationToolActivity[];
  usage?: TwineGenerationUsage;
}

export interface TwineConversationBranchSnapshot {
  forkMessageId?: string;
  id: string;
  messages: readonly TwineConversationMessageSnapshot[];
  parentId?: string;
}

export interface TwineConversationTreeSnapshot {
  activeBranchId: string;
  branches: Readonly<Record<string, TwineConversationBranchSnapshot>>;
  navigationParentId?: string;
}

export interface TwineConversationSnapshot {
  createdAt: number;
  draft?: string;
  id: string;
  nextId: number;
  state: TwineConversationTreeSnapshot;
  title: string;
  updatedAt: number;
  version: 1;
}

export interface TwineConversationSummary {
  createdAt: number;
  id: string;
  title: string;
  updatedAt: number;
}

export interface TwineConversationStoreSnapshot {
  activeConversationId: string | null;
  conversations: readonly TwineConversationSummary[];
  version: 1;
}

export type TwineGenerationEvent =
  | {
      requestId: string;
      type: 'started';
    }
  | {
      requestId: string;
      text: string;
      type: 'thought-delta';
    }
  | {
      requestId: string;
      text: string;
      type: 'text-delta';
    }
  | {
      phase: TwineToolPhase;
      requestId: string;
      text: string;
      tool: TwineToolType;
      type: 'tool';
    }
  | {
      requestId: string;
      sources: readonly TwineSource[];
      type: 'sources';
    }
  | {
      requestId: string;
      type: 'done';
      usage?: TwineGenerationUsage;
    }
  | {
      message: string;
      requestId: string;
      type: 'error';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return values.includes(value as T);
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.trim().length > 0) &&
    value.length <= maximumLength
  );
}

export function isTwineApiKeyInput(value: unknown): value is string {
  return isBoundedString(value, 4096);
}

export function isTwineRequestId(value: unknown): value is string {
  return isBoundedString(value, 128);
}

export function isTwineConversationId(value: unknown): value is string {
  return isBoundedString(value, 128);
}

export function isTwineCredentialStatus(
  value: unknown,
): value is TwineCredentialStatus {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value.encryptionAvailable === 'boolean' &&
    typeof value.hasApiKey === 'boolean'
  );
}

export function isTwineGenerateMessage(
  value: unknown,
): value is TwineGenerateMessage {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    (value.role === 'assistant' || value.role === 'user') &&
    isBoundedString(value.text, 200_000, true)
  );
}

export function isTwineGenerationRequest(
  value: unknown,
): value is TwineGenerationRequest {
  return (
    isRecord(value) &&
    Object.keys(value).length === 6 &&
    includes(TWINE_APPROVAL_MODES, value.approvalMode) &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.length <= 128 &&
    value.messages.every(isTwineGenerateMessage) &&
    includes(TWINE_IPC_MODEL_IDS, value.modelId) &&
    isTwineRequestId(value.requestId) &&
    typeof value.researchEnabled === 'boolean' &&
    includes(TWINE_THINKING_LEVELS, value.thinkingLevel)
  );
}

function isTwineSource(value: unknown): value is TwineSource {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isBoundedString(value.title, 1000) &&
    isBoundedString(value.url, 8192)
  );
}

function isTwineGenerationUsage(value: unknown): value is TwineGenerationUsage {
  if (!isRecord(value)) {
    return false;
  }
  const keys = ['inputTokens', 'outputTokens', 'thoughtTokens', 'totalTokens'];
  return (
    Object.keys(value).every((key) => keys.includes(key)) &&
    Object.values(value).every(
      (entry) =>
        typeof entry === 'number' && Number.isInteger(entry) && entry >= 0,
    )
  );
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 9_000_000_000_000
  );
}

function isTwineConversationAttachmentSnapshot(
  value: unknown,
): value is TwineConversationAttachmentSnapshot {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.name, 1000) &&
    typeof value.size === 'number' &&
    Number.isInteger(value.size) &&
    value.size >= 0 &&
    value.size <= 100 * 1_024 * 1_024
  );
}

function isTwineConversationToolActivity(
  value: unknown,
): value is TwineConversationToolActivity {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    isBoundedString(value.id, 128) &&
    includes(TWINE_TOOL_TYPES, value.tool) &&
    includes(TWINE_TOOL_PHASES, value.phase) &&
    isBoundedString(value.text, 200_000, true)
  );
}

function isTwineConversationMessageSnapshot(
  value: unknown,
): value is TwineConversationMessageSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const allowedKeys = [
    'attachments',
    'id',
    'kind',
    'sources',
    'status',
    'text',
    'thinkingDurationMs',
    'thought',
    'tools',
    'usage',
  ];
  return (
    Object.keys(value).every((key) => allowedKeys.includes(key)) &&
    isBoundedString(value.id, 128) &&
    (value.kind === 'assistant' || value.kind === 'system' || value.kind === 'user') &&
    Array.isArray(value.attachments) &&
    value.attachments.length <= 10 &&
    value.attachments.every(isTwineConversationAttachmentSnapshot) &&
    (value.status === 'complete' || value.status === 'error') &&
    isBoundedString(value.text, 200_000, true) &&
    (value.thought === undefined ||
      isBoundedString(value.thought, 200_000, true)) &&
    (value.thinkingDurationMs === undefined ||
      (typeof value.thinkingDurationMs === 'number' &&
        Number.isFinite(value.thinkingDurationMs) &&
        value.thinkingDurationMs >= 0)) &&
    (value.sources === undefined ||
      (Array.isArray(value.sources) &&
        value.sources.length <= 64 &&
        value.sources.every(isTwineSource))) &&
    (value.tools === undefined ||
      (Array.isArray(value.tools) &&
        value.tools.length <= 128 &&
        value.tools.every(isTwineConversationToolActivity))) &&
    (value.usage === undefined || isTwineGenerationUsage(value.usage))
  );
}

function isTwineConversationBranchSnapshot(
  value: unknown,
): value is TwineConversationBranchSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Object.keys(value).every((key) =>
      ['forkMessageId', 'id', 'messages', 'parentId'].includes(key),
    ) &&
    isBoundedString(value.id, 128) &&
    (value.forkMessageId === undefined ||
      isBoundedString(value.forkMessageId, 128)) &&
    (value.parentId === undefined || isBoundedString(value.parentId, 128)) &&
    Array.isArray(value.messages) &&
    value.messages.length <= 256 &&
    value.messages.every(isTwineConversationMessageSnapshot)
  );
}

function isTwineConversationTreeSnapshot(
  value: unknown,
): value is TwineConversationTreeSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const branches = value.branches;
  if (
    !Object.keys(value).every((key) =>
      ['activeBranchId', 'branches', 'navigationParentId'].includes(key),
    ) ||
    !isBoundedString(value.activeBranchId, 128) ||
    (value.navigationParentId !== undefined &&
      !isBoundedString(value.navigationParentId, 128)) ||
    !isRecord(branches)
  ) {
    return false;
  }
  const entries = Object.entries(branches);
  return (
    entries.length > 0 &&
    entries.length <= 64 &&
    entries.every(
      ([id, branch]) => id === (branch as { id?: unknown }).id &&
        isTwineConversationBranchSnapshot(branch),
    ) &&
    Object.prototype.hasOwnProperty.call(branches, value.activeBranchId) &&
    (value.navigationParentId === undefined ||
      Object.prototype.hasOwnProperty.call(branches, value.navigationParentId))
  );
}

export function isTwineConversationSnapshot(
  value: unknown,
): value is TwineConversationSnapshot {
  return (
    isRecord(value) &&
    (Object.keys(value).length === 7 || Object.keys(value).length === 8) &&
    value.version === 1 &&
    (value.draft === undefined ||
      isBoundedString(value.draft, 200_000, true)) &&
    isTwineConversationId(value.id) &&
    isBoundedString(value.title, 120) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    typeof value.nextId === 'number' &&
    Number.isInteger(value.nextId) &&
    value.nextId >= 1 &&
    value.nextId <= 1_000_000 &&
    isTwineConversationTreeSnapshot(value.state)
  );
}

export function isTwineConversationSummary(
  value: unknown,
): value is TwineConversationSummary {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    isTwineConversationId(value.id) &&
    isBoundedString(value.title, 120) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

export function isTwineConversationStoreSnapshot(
  value: unknown,
): value is TwineConversationStoreSnapshot {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.version === 1 &&
    (value.activeConversationId === null ||
      isTwineConversationId(value.activeConversationId)) &&
    Array.isArray(value.conversations) &&
    value.conversations.length <= 64 &&
    value.conversations.every(isTwineConversationSummary)
  );
}

export function isTwineGenerationEvent(
  value: unknown,
): value is TwineGenerationEvent {
  if (!isRecord(value) || !isTwineRequestId(value.requestId)) {
    return false;
  }

  switch (value.type) {
    case 'started':
      return Object.keys(value).length === 2;
    case 'thought-delta':
    case 'text-delta':
      return (
        Object.keys(value).length === 3 &&
        isBoundedString(value.text, 200_000, true)
      );
    case 'tool':
      return (
        Object.keys(value).length === 5 &&
        isBoundedString(value.text, 200_000, true) &&
        includes(TWINE_TOOL_TYPES, value.tool) &&
        includes(TWINE_TOOL_PHASES, value.phase)
      );
    case 'sources':
      return (
        Object.keys(value).length === 3 &&
        Array.isArray(value.sources) &&
        value.sources.length <= 64 &&
        value.sources.every(isTwineSource)
      );
    case 'done':
      return (
        (Object.keys(value).length === 2 || Object.keys(value).length === 3) &&
        (value.usage === undefined || isTwineGenerationUsage(value.usage))
      );
    case 'error':
      return (
        Object.keys(value).length === 3 &&
        isBoundedString(value.message, 20_000)
      );
    default:
      return false;
  }
}
