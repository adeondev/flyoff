import { useCallback, useReducer, useRef } from 'react';

export type ToastTone = 'info' | 'error';

export interface ToastDescriptor {
  id: string;
  message: string;
  tone: ToastTone;
  duration: number;
}

export interface ToastQueueState {
  visible: readonly ToastDescriptor[];
  queued: readonly ToastDescriptor[];
}

type ToastQueueAction =
  | { type: 'enqueue'; toast: ToastDescriptor }
  | { type: 'dismiss'; id: string };

export const EMPTY_TOAST_QUEUE: ToastQueueState = {
  visible: [],
  queued: [],
};

export function toastQueueReducer(
  state: ToastQueueState,
  action: ToastQueueAction,
): ToastQueueState {
  if (action.type === 'enqueue') {
    if (
      [...state.visible, ...state.queued].some(
        ({ message, tone }) =>
          message === action.toast.message && tone === action.toast.tone,
      )
    ) {
      return state;
    }
    return state.visible.length < 4
      ? { ...state, visible: [action.toast, ...state.visible] }
      : { ...state, queued: [...state.queued, action.toast] };
  }

  if (!state.visible.some(({ id }) => id === action.id)) {
    return {
      ...state,
      queued: state.queued.filter(({ id }) => id !== action.id),
    };
  }

  const [promoted, ...queued] = state.queued;
  return {
    visible: [
      ...(promoted ? [promoted] : []),
      ...state.visible.filter(({ id }) => id !== action.id),
    ],
    queued,
  };
}

export function useToastQueue() {
  const [state, dispatch] = useReducer(toastQueueReducer, EMPTY_TOAST_QUEUE);
  const nextIdRef = useRef(0);

  const pushToast = useCallback((message: string, tone: ToastTone): void => {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    nextIdRef.current += 1;
    dispatch({
      type: 'enqueue',
      toast: {
        id: `toast-${nextIdRef.current}`,
        message: normalized,
        tone,
        duration: tone === 'error' ? 8_000 : 5_000,
      },
    });
  }, []);

  const dismissToast = useCallback((id: string): void => {
    dispatch({ type: 'dismiss', id });
  }, []);

  return {
    dismissToast,
    pushToast,
    toasts: state.visible,
  };
}
