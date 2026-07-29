import { ipcMain } from 'electron';

import {
  isTwineApiKeyInput,
  isTwineConversationId,
  isTwineConversationSnapshot,
  isTwineDocumentToolResultSubmission,
  isTwineGenerationRequest,
  isTwineRequestId,
  TWINE_CANCEL_GENERATION_CHANNEL,
  TWINE_CREATE_CONVERSATION_CHANNEL,
  TWINE_CREDENTIAL_STATUS_CHANNEL,
  TWINE_DELETE_CONVERSATION_CHANNEL,
  TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
  TWINE_GENERATION_EVENT_CHANNEL,
  TWINE_LIST_CONVERSATIONS_CHANNEL,
  TWINE_LOAD_CONVERSATION_CHANNEL,
  TWINE_REMOVE_API_KEY_CHANNEL,
  TWINE_SAVE_CONVERSATION_CHANNEL,
  TWINE_SAVE_API_KEY_CHANNEL,
  TWINE_START_GENERATION_CHANNEL,
} from '../../shared/contracts';
import type {
  TwineConversationStore,
  TwineCredentialStore,
  TwineGenerationService,
} from '../twine';
import { validateTrustedMainFrame } from './trusted-sender';

interface TwineHandlerOptions {
  conversationStore: TwineConversationStore;
  credentialStore: TwineCredentialStore;
  generationService: TwineGenerationService;
  isAllowedUrl: (url: string) => boolean;
}

export function registerTwineHandlers({
  conversationStore,
  credentialStore,
  generationService,
  isAllowedUrl,
}: TwineHandlerOptions): () => void {
  ipcMain.handle(TWINE_CREDENTIAL_STATUS_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine credentials');
    return credentialStore.getStatus();
  });

  ipcMain.handle(TWINE_SAVE_API_KEY_CHANNEL, (event, apiKey: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine credentials');
    if (!isTwineApiKeyInput(apiKey)) {
      throw new TypeError('Invalid Twine API key.');
    }
    return credentialStore.saveApiKey(apiKey);
  });

  ipcMain.handle(TWINE_REMOVE_API_KEY_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine credentials');
    return credentialStore.removeApiKey();
  });

  ipcMain.handle(TWINE_LIST_CONVERSATIONS_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine conversations');
    return conversationStore.list();
  });

  ipcMain.handle(TWINE_LOAD_CONVERSATION_CHANNEL, (event, id: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine conversations');
    if (!isTwineConversationId(id)) {
      throw new TypeError('Invalid Twine conversation id.');
    }
    return conversationStore.load(id);
  });

  ipcMain.handle(
    TWINE_SAVE_CONVERSATION_CHANNEL,
    (event, conversation: unknown) => {
      validateTrustedMainFrame(event, isAllowedUrl, 'Twine conversations');
      if (!isTwineConversationSnapshot(conversation)) {
        throw new TypeError('Invalid Twine conversation snapshot.');
      }
      return conversationStore.save(conversation);
    },
  );

  ipcMain.handle(TWINE_CREATE_CONVERSATION_CHANNEL, (event) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine conversations');
    return conversationStore.create();
  });

  ipcMain.handle(TWINE_DELETE_CONVERSATION_CHANNEL, (event, id: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine conversations');
    if (!isTwineConversationId(id)) {
      throw new TypeError('Invalid Twine conversation id.');
    }
    return conversationStore.delete(id);
  });

  ipcMain.handle(TWINE_START_GENERATION_CHANNEL, (event, request: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine generation');
    if (!isTwineGenerationRequest(request)) {
      throw new TypeError('Invalid Twine generation request.');
    }
    const apiKey = credentialStore.getApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key is missing.');
    }

    generationService.start(
      request,
      apiKey,
      event.sender,
      TWINE_GENERATION_EVENT_CHANNEL,
    );
  });

  ipcMain.handle(TWINE_CANCEL_GENERATION_CHANNEL, (event, requestId: unknown) => {
    validateTrustedMainFrame(event, isAllowedUrl, 'Twine generation');
    if (!isTwineRequestId(requestId)) {
      throw new TypeError('Invalid Twine request id.');
    }
    generationService.cancel(requestId);
  });

  ipcMain.handle(
    TWINE_DOCUMENT_TOOL_RESULT_CHANNEL,
    (event, submission: unknown) => {
      validateTrustedMainFrame(event, isAllowedUrl, 'Twine document tool');
      if (!isTwineDocumentToolResultSubmission(submission)) {
        throw new TypeError('Invalid Twine document tool result.');
      }
      if (!generationService.submitDocumentToolResult(submission)) {
        throw new Error('The Twine document tool call is no longer active.');
      }
    },
  );

  return () => {
    generationService.cancelAll();
    ipcMain.removeHandler(TWINE_CREDENTIAL_STATUS_CHANNEL);
    ipcMain.removeHandler(TWINE_SAVE_API_KEY_CHANNEL);
    ipcMain.removeHandler(TWINE_REMOVE_API_KEY_CHANNEL);
    ipcMain.removeHandler(TWINE_LIST_CONVERSATIONS_CHANNEL);
    ipcMain.removeHandler(TWINE_LOAD_CONVERSATION_CHANNEL);
    ipcMain.removeHandler(TWINE_SAVE_CONVERSATION_CHANNEL);
    ipcMain.removeHandler(TWINE_CREATE_CONVERSATION_CHANNEL);
    ipcMain.removeHandler(TWINE_DELETE_CONVERSATION_CHANNEL);
    ipcMain.removeHandler(TWINE_START_GENERATION_CHANNEL);
    ipcMain.removeHandler(TWINE_CANCEL_GENERATION_CHANNEL);
    ipcMain.removeHandler(TWINE_DOCUMENT_TOOL_RESULT_CHANNEL);
  };
}
