import type { GalleryEntry } from './media-gallery-model';

export type MediaGalleryInteraction =
  | { type: 'idle' }
  | { type: 'creating-folder'; draftId: string; parentId: string | null }
  | { type: 'renaming'; entry: GalleryEntry }
  | { type: 'dragging'; entryIds: readonly string[] }
  | { type: 'quick-preview'; assetId: string }
  | { type: 'context-menu' }
  | { type: 'dialog' };

export type MediaGalleryInteractionAction =
  | { type: 'cancel' }
  | { type: 'create-folder'; draftId: string; parentId: string | null }
  | { type: 'rename'; entry: GalleryEntry }
  | { type: 'drag'; entryIds: readonly string[] }
  | { type: 'preview'; assetId: string }
  | { type: 'open-context' }
  | { type: 'open-dialog' }
  | { type: 'finish' };

export const idleMediaGalleryInteraction: MediaGalleryInteraction = {
  type: 'idle',
};

export function reduceMediaGalleryInteraction(
  state: MediaGalleryInteraction,
  action: MediaGalleryInteractionAction,
): MediaGalleryInteraction {
  switch (action.type) {
    case 'cancel':
    case 'finish':
      return idleMediaGalleryInteraction;
    case 'create-folder':
      return {
        type: 'creating-folder',
        draftId: action.draftId,
        parentId: action.parentId,
      };
    case 'rename':
      return { type: 'renaming', entry: action.entry };
    case 'drag':
      return { type: 'dragging', entryIds: action.entryIds };
    case 'preview':
      return { type: 'quick-preview', assetId: action.assetId };
    case 'open-context':
      return { type: 'context-menu' };
    case 'open-dialog':
      return { type: 'dialog' };
    default:
      return state;
  }
}
