import type { TwineConversationMemory } from '../../shared/contracts';
import type {
  TwineConversationBranch,
  TwineConversationState,
  TwineMessage,
} from './twine-types';

export const TWINE_ROOT_BRANCH_ID = 'twine-root';

export function createTwineConversationState(): TwineConversationState {
  return {
    activeBranchId: TWINE_ROOT_BRANCH_ID,
    branches: {
      [TWINE_ROOT_BRANCH_ID]: {
        id: TWINE_ROOT_BRANCH_ID,
        messages: [],
      },
    },
  };
}

export function activeTwineBranch(
  state: TwineConversationState,
): TwineConversationBranch {
  return state.branches[state.activeBranchId] ?? state.branches[TWINE_ROOT_BRANCH_ID]!;
}

export function updateTwineBranchMessages(
  state: TwineConversationState,
  branchId: string,
  update: (messages: readonly TwineMessage[]) => readonly TwineMessage[],
): TwineConversationState {
  const branch = state.branches[branchId];
  if (!branch) {
    return state;
  }
  return {
    ...state,
    branches: {
      ...state.branches,
      [branchId]: { ...branch, messages: update(branch.messages) },
    },
  };
}

export function updateTwineBranchMemory(
  state: TwineConversationState,
  branchId: string,
  memory: TwineConversationMemory | undefined,
): TwineConversationState {
  const branch = state.branches[branchId];
  if (!branch || branch.memory === memory) {
    return state;
  }
  return {
    ...state,
    branches: {
      ...state.branches,
      [branchId]: { ...branch, memory },
    },
  };
}

export function updateTwineMessageByRequest(
  state: TwineConversationState,
  requestId: string,
  update: (message: TwineMessage) => TwineMessage,
): TwineConversationState {
  const branch = Object.values(state.branches).find(({ messages }) =>
    messages.some(({ streamRequestId }) => streamRequestId === requestId),
  );
  if (!branch) {
    return state;
  }
  return updateTwineBranchMessages(state, branch.id, (messages) =>
    messages.map((message) =>
      message.streamRequestId === requestId ? update(message) : message,
    ),
  );
}

export function forkTwineConversation(
  state: TwineConversationState,
  options: {
    branchId: string;
    forkMessageId: string;
    memory?: TwineConversationMemory;
    messages: readonly TwineMessage[];
  },
): TwineConversationState {
  const active = activeTwineBranch(state);
  const familyParent =
    active.parentId && active.forkMessageId === options.forkMessageId
      ? active.parentId
      : active.id;
  const branch: TwineConversationBranch = {
    forkMessageId: options.forkMessageId,
    id: options.branchId,
    ...(options.memory ? { memory: options.memory } : {}),
    messages: options.messages,
    parentId: familyParent,
  };
  return {
    activeBranchId: branch.id,
    branches: { ...state.branches, [branch.id]: branch },
    navigationParentId: familyParent,
  };
}

export function twineConversationVariants(
  state: TwineConversationState,
): readonly TwineConversationBranch[] {
  const parentId = state.navigationParentId;
  if (!parentId) {
    return [];
  }
  const parent = state.branches[parentId];
  if (!parent) {
    return [];
  }
  return [
    parent,
    ...Object.values(state.branches).filter(
      (branch) => branch.parentId === parentId,
    ),
  ];
}

export function selectTwineVariant(
  state: TwineConversationState,
  offset: -1 | 1,
): TwineConversationState {
  const variants = twineConversationVariants(state);
  const index = variants.findIndex(({ id }) => id === state.activeBranchId);
  if (index < 0) {
    return state;
  }
  const next = variants[index + offset];
  return next ? { ...state, activeBranchId: next.id } : state;
}

export function truncateActiveTwineConversation(
  state: TwineConversationState,
  messageId: string,
  includeMessage: boolean,
): TwineConversationState {
  const branch = activeTwineBranch(state);
  const index = branch.messages.findIndex(({ id }) => id === messageId);
  if (index < 0) {
    return state;
  }
  const messages = branch.messages.slice(0, index + (includeMessage ? 1 : 0));
  const memory = branch.memory
    ? messages.some(({ id }) => id === branch.memory?.throughMessageId)
      ? branch.memory
      : undefined
    : undefined;
  return {
    activeBranchId: branch.id,
    branches: {
      [branch.id]: {
        id: branch.id,
        ...(memory ? { memory } : {}),
        messages,
      },
    },
  };
}
