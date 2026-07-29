import type {
  TwineGenerationUsage,
  TwineSource,
  TwineToolPhase,
  TwineToolType,
} from '../../shared/contracts';

export interface TwineAttachment {
  file: File;
  id: string;
  previewUrl?: string;
}

export interface TwineMessageAttachment {
  id: string;
  name: string;
  previewUrl?: string;
  size: number;
}

export interface TwineMessage {
  attachments: readonly TwineMessageAttachment[];
  id: string;
  kind: 'assistant' | 'system' | 'user';
  sources?: readonly TwineSource[];
  status?: 'complete' | 'error' | 'streaming';
  streamRequestId?: string;
  text: string;
  thinkingDurationMs?: number;
  thinkingStartedAt?: number;
  thought?: string;
  tools?: readonly TwineToolActivity[];
  usage?: TwineGenerationUsage;
}

export interface TwineToolActivity {
  id: string;
  phase: TwineToolPhase;
  text: string;
  tool: TwineToolType;
}

export interface TwineConversationBranch {
  forkMessageId?: string;
  id: string;
  messages: readonly TwineMessage[];
  parentId?: string;
}

export interface TwineConversationState {
  activeBranchId: string;
  branches: Readonly<Record<string, TwineConversationBranch>>;
  navigationParentId?: string;
}

export interface TwineConversationScrollState {
  anchorMessageId?: string;
  anchorOffset?: number;
  follow: boolean;
  scrollTop: number;
}
