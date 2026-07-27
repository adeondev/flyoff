import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import arrowLeftIcon from '../../../public/images/icons/actions/arrow-left.svg';
import chevronRightIcon from '../../../public/images/icons/actions/chevron-right.svg';
import plusIcon from '../../../public/images/icons/actions/plus.svg';
import refreshIcon from '../../../public/images/icons/actions/refresh.svg';
import folderIcon from '../../../public/images/icons/instances/folder-solid.svg';
import type {
  MediaAsset,
  MediaFolder,
  MediaGallerySnapshot,
  MediaGallerySort,
  MediaGalleryEntryRef,
  MediaGalleryViewState,
  ProjectMediaImportProgress,
} from '../../shared/contracts';
import { mediaAssetUrl } from '../../shared/markdown';
import { Dialog } from '../components/dialog';
import { MaskedIcon } from '../components/MaskedIcon';
import {
  ContextMenu,
  DropdownMenu,
  type MenuItem,
} from '../components/menu';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import {
  idleMediaGalleryInteraction,
  reduceMediaGalleryInteraction,
} from './media-gallery-interaction';
import {
  buildMediaGalleryEntries,
  canMoveMediaGalleryEntries,
  formatMediaBytes,
  formatMediaDimensions,
  mediaGalleryEntryName,
  type GalleryEntry,
  type MediaGalleryDensity,
  type MediaGallerySearchScope,
  type MediaGalleryViewMode,
} from './media-gallery-model';
import {
  beginImageDrag,
  finishImageDrag,
  moveImageDrag,
  returnImageDrag,
  transparentNativeDragImage,
} from './image-drag-coordinator';
import {
  MEDIA_ASSET_TRANSFER,
  MEDIA_ENTRY_TRANSFER,
  MEDIA_LIBRARY_CHANGED_EVENT,
} from './media-transfer';
import {
  SearchComposer,
  type SearchComposerSuggestion,
} from './SearchComposer';
import {
  emptyCollectionSelection,
  pruneCollectionSelection,
  selectAllVisibleCollectionItems,
  selectCollectionItem,
  selectCollectionRange,
  toggleCollectionItem,
  type CollectionSelection,
} from './collection-selection';
import { useCollectionMarquee } from './use-collection-marquee';
import { useMediaGalleryVirtualizer } from './use-media-gallery-virtualizer';

interface ContextRequest {
  entry?: GalleryEntry;
  x: number;
  y: number;
}

interface DeleteRequest {
  entries: readonly MediaGalleryEntryRef[];
  removedAssetIds: readonly string[];
  usageCount: number;
}

interface MoveRequest {
  destinationId: string | null;
  entries: readonly MediaGalleryEntryRef[];
}

const MEDIA_SEARCH_SUGGESTIONS = [
  ['path', 'path:', 'projects.mediaSearchPathDescription'],
  ['file', 'file:', 'projects.mediaSearchFileDescription'],
  ['type', 'type:', 'projects.mediaSearchTypeDescription'],
  ['date', 'date:', 'projects.mediaSearchDateDescription'],
  ['size', 'size:', 'projects.mediaSearchSizeDescription'],
  ['width', 'width:', 'projects.mediaSearchWidthDescription'],
  ['height', 'height:', 'projects.mediaSearchHeightDescription'],
  [
    'orientation',
    'orientation:',
    'projects.mediaSearchOrientationDescription',
  ],
  ['used', 'used:', 'projects.mediaSearchUsedDescription'],
] as const;

export interface MediaGalleryPanelHandle {
  refresh: () => Promise<boolean>;
  reveal: (assetId: string) => Promise<void>;
}

export interface MediaGalleryPanelProps {
  projectId: string;
  onError?: (message: string) => void;
  onInsertAsset?: (asset: MediaAsset) => void;
  onOpenAsset?: (asset: MediaAsset) => void;
  onAssetsRemoved?: (assetIds: readonly string[]) => void;
  translate: Translate;
}

export function selectedForClick(
  current: CollectionSelection,
  entryId: string,
  visible: readonly GalleryEntry[],
  shift: boolean,
  toggle: boolean,
): CollectionSelection {
  const visibleIds = visible.map(({ id }) => id);
  if (shift) {
    const selection = selectCollectionRange(
      current,
      visibleIds,
      entryId,
      toggle,
    );
    return {
      anchorId: selection.anchorId,
      selectedIds: selection.selectedIds,
    };
  }
  if (toggle) {
    return toggleCollectionItem(current, entryId);
  }
  return selectCollectionItem(entryId);
}

export const MediaGalleryPanel = forwardRef<
  MediaGalleryPanelHandle,
  MediaGalleryPanelProps
>(function MediaGalleryPanel(
  {
    onAssetsRemoved,
    onError,
    onInsertAsset,
    onOpenAsset,
    projectId,
    translate,
  },
  forwardedRef,
) {
  const { preferences, update: updatePreferences } = useFlyoffPreferences();
  const savedProjectView =
    preferences.workspace.mediaGalleryProjects[projectId];
  const [snapshot, setSnapshot] = useState<MediaGallerySnapshot>();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selection, setSelection] = useState<CollectionSelection>(
    emptyCollectionSelection,
  );
  const [focusedId, setFocusedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [usageCounts, setUsageCounts] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [sort, setSort] = useState<MediaGallerySort>(
    preferences.workspace.mediaGallerySort,
  );
  const [viewMode, setViewMode] = useState<MediaGalleryViewMode>(
    preferences.workspace.mediaGalleryView,
  );
  const [density, setDensity] = useState<MediaGalleryDensity>(
    preferences.workspace.mediaGalleryDensity,
  );
  const [searchScope, setSearchScope] = useState<MediaGallerySearchScope>(
    preferences.workspace.mediaGallerySearchScope,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [context, setContext] = useState<ContextRequest>();
  const [creatingFolder, setCreatingFolder] = useState<{
    draftId: string;
    entries?: readonly MediaGalleryEntryRef[];
    parentId: string | null;
  }>();
  const [editing, setEditing] = useState<GalleryEntry>();
  const [quickPreviewId, setQuickPreviewId] = useState<string>();
  const [dropTargetId, setDropTargetId] = useState<string | null>();
  const [pendingEntryId, setPendingEntryId] = useState<string>();
  const [interaction, dispatchInteraction] = useReducer(
    reduceMediaGalleryInteraction,
    idleMediaGalleryInteraction,
  );
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest>();
  const [moveRequest, setMoveRequest] = useState<MoveRequest>();
  const [properties, setProperties] = useState<{
    asset: MediaAsset;
    usages?: number;
  }>();
  const [folderProperties, setFolderProperties] = useState<{
    assetCount: number;
    folder: MediaFolder;
    folderCount: number;
    path: string;
    sizeBytes: number;
  }>();
  const [importProgress, setImportProgress] =
    useState<ProjectMediaImportProgress>();
  const importOperationRef = useRef<string | undefined>(undefined);
  const importProgressCleanupRef = useRef<() => void>(() => undefined);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigationHistoryRef = useRef<(string | null)[]>([]);
  const navigationForwardRef = useRef<(string | null)[]>([]);
  const activeProjectRef = useRef<string | undefined>(undefined);
  const hoverFolderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    setSort(savedProjectView?.sort ?? preferences.workspace.mediaGallerySort);
    setViewMode(
      savedProjectView?.viewMode ?? preferences.workspace.mediaGalleryView,
    );
    setDensity(
      savedProjectView?.density ?? preferences.workspace.mediaGalleryDensity,
    );
    setSearchScope(
      savedProjectView?.searchScope ??
        preferences.workspace.mediaGallerySearchScope,
    );
  }, [
    preferences.workspace.mediaGalleryDensity,
    preferences.workspace.mediaGallerySearchScope,
    preferences.workspace.mediaGallerySort,
    preferences.workspace.mediaGalleryView,
    savedProjectView?.density,
    savedProjectView?.searchScope,
    savedProjectView?.sort,
    savedProjectView?.viewMode,
  ]);

  const updateMediaPreferences = useCallback(
    (
      patch: Partial<{
        mediaGalleryDensity: MediaGalleryDensity;
        mediaGallerySearchScope: MediaGallerySearchScope;
        mediaGallerySort: MediaGallerySort;
        mediaGalleryView: MediaGalleryViewMode;
      }>,
      location?: {
        folderId: string | null;
        history: readonly (string | null)[];
      },
    ): void => {
      updatePreferences((current) => {
        const previous = current.workspace.mediaGalleryProjects[projectId];
        const nextViewState: MediaGalleryViewState = {
          version: 1,
          viewMode:
            patch.mediaGalleryView ??
            previous?.viewMode ??
            current.workspace.mediaGalleryView,
          density:
            patch.mediaGalleryDensity ??
            previous?.density ??
            current.workspace.mediaGalleryDensity,
          searchScope:
            patch.mediaGallerySearchScope ??
            previous?.searchScope ??
            current.workspace.mediaGallerySearchScope,
          sort:
            patch.mediaGallerySort ??
            previous?.sort ??
            current.workspace.mediaGallerySort,
          folderId: location
            ? location.folderId
            : previous
              ? previous.folderId
              : folderId,
          history: location
            ? location.history
            : (previous?.history ?? navigationHistoryRef.current),
        };
        return {
          ...current,
          workspace: {
            ...current.workspace,
            ...patch,
            mediaGalleryProjects: {
              ...current.workspace.mediaGalleryProjects,
              [projectId]: nextViewState,
            },
          },
        };
      });
    },
    [folderId, projectId, updatePreferences],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.flyoff.getMediaGallery();
      if (!result.ok) {
        setError(result.error.message);
        onError?.(result.error.message);
        return false;
      }
      setSnapshot(result.value);
      setError(undefined);
      return true;
    } catch (reason) {
      const message = String(reason);
      setError(message);
      onError?.(message);
      return false;
    }
  }, [onError]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      refresh,
      async reveal(assetId: string) {
        let current = snapshot;
        if (!current) {
          const result = await window.flyoff.getMediaGallery();
          if (!result.ok) {
            onError?.(result.error.message);
            return;
          }
          current = result.value;
        }
        const asset = current.assets.find(
          (candidate) => candidate.assetId === assetId,
        );
        if (!asset) {
          return;
        }
        setSnapshot(current);
        setFolderId(asset.folderId);
        setSelection({
          anchorId: assetId,
          selectedIds: new Set([assetId]),
        });
        requestAnimationFrame(() => {
          itemRefs.current.get(assetId)?.focus();
          itemRefs.current.get(assetId)?.scrollIntoView({ block: 'nearest' });
        });
      },
    }),
    [onError, refresh, snapshot],
  );

  useEffect(() => {
    if (activeProjectRef.current === projectId) {
      return;
    }
    activeProjectRef.current = projectId;
    setFolderId(savedProjectView?.folderId ?? null);
    setQuery('');
    setSelection(emptyCollectionSelection());
    setFocusedId(undefined);
    navigationHistoryRef.current = [...(savedProjectView?.history ?? [])];
    navigationForwardRef.current = [];
  }, [projectId, savedProjectView?.folderId, savedProjectView?.history]);

  useEffect(() => {
    void refresh();
  }, [projectId, refresh]);

  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener(MEDIA_LIBRARY_CHANGED_EVENT, changed);
    return () =>
      window.removeEventListener(MEDIA_LIBRARY_CHANGED_EVENT, changed);
  }, [refresh]);

  useEffect(
    () => () => {
      importProgressCleanupRef.current();
      const operationId = importOperationRef.current;
      if (operationId) {
        void window.flyoff.cancelProjectMediaImport({ operationId });
      }
      if (hoverFolderTimerRef.current) {
        clearTimeout(hoverFolderTimerRef.current);
      }
      if (typeaheadTimerRef.current) {
        clearTimeout(typeaheadTimerRef.current);
      }
    },
    [],
  );

  const folderById = useMemo(
    () => new Map(snapshot?.folders.map((folder) => [folder.folderId, folder])),
    [snapshot],
  );
  useEffect(() => {
    if (!snapshot || !folderId || folderById.has(folderId)) {
      return;
    }
    navigationHistoryRef.current = navigationHistoryRef.current.filter(
      (id) => id === null || folderById.has(id),
    );
    navigationForwardRef.current = [];
    setFolderId(null);
    updateMediaPreferences(
      {},
      { folderId: null, history: navigationHistoryRef.current },
    );
  }, [folderById, folderId, snapshot, updateMediaPreferences]);
  const entries = useMemo(
    () =>
      buildMediaGalleryEntries({
        folderId,
        query,
        scope: searchScope,
        snapshot,
        sort,
        usageCounts,
      }),
    [folderId, query, searchScope, snapshot, sort, usageCounts],
  );
  const imageEntries = useMemo(
    () =>
      entries.filter(
        (entry): entry is Extract<GalleryEntry, { kind: 'asset' }> =>
          entry.kind === 'asset',
      ),
    [entries],
  );
  const quickPreviewAsset = snapshot?.assets.find(
    ({ assetId }) => assetId === quickPreviewId,
  );
  const virtualizer = useMediaGalleryVirtualizer({
    density,
    itemIds: entries.map(({ id }) => id),
    scrollRef,
    viewMode,
  });
  const scrollVirtualIndex = virtualizer.scrollToIndex;
  const renderedEntries = entries.slice(
    virtualizer.startIndex,
    virtualizer.endIndex,
  );

  useEffect(() => {
    if (!focusedId) {
      return;
    }
    const index = entries.findIndex(({ id }) => id === focusedId);
    if (index === -1) {
      return;
    }
    scrollVirtualIndex(index);
    const frameId = requestAnimationFrame(() =>
      itemRefs.current.get(focusedId)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frameId);
  }, [entries, focusedId, scrollVirtualIndex]);

  useEffect(() => {
    if (!/(?:^|\s)used:/iu.test(query) || !snapshot) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      snapshot.assets
        .filter(({ kind }) => kind === 'image')
        .map(async ({ assetId }) => {
          const result = await window.flyoff.listProjectMediaUsages({
            nodeId: assetId,
          });
          return [
            assetId,
            result.ok
              ? result.value.reduce((total, usage) => total + usage.count, 0)
              : 0,
          ] as const;
        }),
    ).then((counts) => {
      if (!cancelled) {
        setUsageCounts(new Map(counts));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [query, snapshot]);

  useEffect(() => {
    if (!quickPreviewId) {
      return;
    }
    const handleQuickPreviewKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === ' ') {
        event.preventDefault();
        setQuickPreviewId(undefined);
        dispatchInteraction({ type: 'cancel' });
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }
      const index = imageEntries.findIndex(
        ({ asset }) => asset.assetId === quickPreviewId,
      );
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const next = imageEntries[index + direction];
      if (next) {
        event.preventDefault();
        setQuickPreviewId(next.asset.assetId);
      }
    };
    document.addEventListener('keydown', handleQuickPreviewKey, true);
    return () =>
      document.removeEventListener('keydown', handleQuickPreviewKey, true);
  }, [imageEntries, quickPreviewId]);

  const breadcrumbs = useMemo(() => {
    const result: MediaFolder[] = [];
    let cursor = folderId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const folder = folderById.get(cursor);
      if (!folder) {
        break;
      }
      result.unshift(folder);
      cursor = folder.parentId;
    }
    return result;
  }, [folderById, folderId]);

  function acceptSnapshot(next: MediaGallerySnapshot): void {
    setSnapshot(next);
    const availableIds = new Set([
      ...next.folders.map(({ folderId: id }) => id),
      ...next.assets.map(({ assetId: id }) => id),
    ]);
    setSelection((current) =>
      pruneCollectionSelection(current, availableIds),
    );
    setFocusedId((current) =>
      current && availableIds.has(current) ? current : undefined,
    );
    setError(undefined);
  }

  async function importImages(
    files?: readonly File[],
    destinationFolderId: string | null = folderId,
  ): Promise<void> {
    setBusy(true);
    try {
      if (files) {
        let stopProgress = (): void => undefined;
        const terminal = new Promise<ProjectMediaImportProgress>((resolve) => {
          stopProgress = window.flyoff.onProjectMediaImportProgress(
            (progress) => {
              if (progress.operationId !== importOperationRef.current) {
                return;
              }
              setImportProgress(progress);
              if (progress.status !== 'running') {
                stopProgress();
                resolve(progress);
              }
            },
          );
          importProgressCleanupRef.current = stopProgress;
        });
        const started = await window.flyoff.startDroppedProjectMediaImport(
          files,
          {
            parentId: null,
            folderId: destinationFolderId,
          },
        );
        if (!started.ok) {
          stopProgress();
          importProgressCleanupRef.current = () => undefined;
          onError?.(started.error.message);
          return;
        }
        importOperationRef.current = started.value.operationId;
        setImportProgress({
          operationId: started.value.operationId,
          completed: 0,
          currentName: '',
          failed: 0,
          total: files.length,
          status: 'running',
        });
        const finished = await terminal;
        importProgressCleanupRef.current = () => undefined;
        if (finished.status === 'failed' && finished.error) {
          onError?.(finished.error.message);
        }
        await refresh();
        return;
      }
      const result = await window.flyoff.selectProjectMedia({
        parentId: null,
        folderId: destinationFolderId,
      });
      if (!result.ok && result.error.code !== 'cancelled') {
        onError?.(result.error.message);
      }
      if (result.ok) {
        await refresh();
      }
    } finally {
      importOperationRef.current = undefined;
      setBusy(false);
    }
  }

  async function createFolder(name: string): Promise<void> {
    const draft = creatingFolder;
    if (!draft || pendingEntryId === draft.draftId) {
      return;
    }
    setPendingEntryId(draft.draftId);
    try {
      const request = {
        expectedRevision: snapshot?.revision,
        parentId: draft.parentId,
        name,
      };
      const result = draft.entries
        ? await window.flyoff.createMediaFolderWithEntries({
            ...request,
            entries: draft.entries,
          })
        : await window.flyoff.createMediaFolder(request);
      if (result.ok) {
        acceptSnapshot(result.value);
        setCreatingFolder(undefined);
        dispatchInteraction({ type: 'finish' });
        const created = result.value.folders.find(
          (folder) =>
            folder.parentId === draft.parentId && folder.name === name,
        );
        if (created) {
          setFocusedId(created.folderId);
          setSelection(selectCollectionItem(created.folderId));
          requestAnimationFrame(() =>
            itemRefs.current.get(created.folderId)?.focus(),
          );
        }
      } else {
        onError?.(result.error.message);
      }
    } catch (reason) {
      onError?.(String(reason));
    } finally {
      setPendingEntryId((current) =>
        current === draft.draftId ? undefined : current,
      );
    }
  }

  async function renameEntry(entry: GalleryEntry, name: string): Promise<void> {
    if (pendingEntryId === entry.id) {
      return;
    }
    setPendingEntryId(entry.id);
    try {
      const result = await window.flyoff.renameMediaEntry({
        entryId: entry.id,
        expectedRevision: snapshot?.revision,
        kind: entry.kind,
        name,
      });
      if (result.ok) {
        acceptSnapshot(result.value);
        setEditing(undefined);
        dispatchInteraction({ type: 'finish' });
      } else {
        onError?.(result.error.message);
      }
    } finally {
      setPendingEntryId((current) =>
        current === entry.id ? undefined : current,
      );
    }
  }

  async function requestDelete(entry: GalleryEntry): Promise<void> {
    const selected = selection.selectedIds.has(entry.id)
      ? entries.filter((candidate) => selection.selectedIds.has(candidate.id))
      : [entry];
    const assetIds = selected.flatMap((candidate) =>
      candidate.kind === 'asset' ? [candidate.id] : [],
    );
    const folderIds = selected.flatMap((candidate) =>
      candidate.kind === 'folder' ? [candidate.id] : [],
    );
    let usageCount = 0;
    const affectedAssetIds = new Set(assetIds);
    if (snapshot && folderIds.length > 0) {
      for (const asset of snapshot.assets) {
        if (
          folderIds.some((folder) => {
            let parentId = asset.folderId;
            while (parentId) {
              if (parentId === folder) {
                return true;
              }
              parentId = folderById.get(parentId)?.parentId ?? null;
            }
            return false;
          })
        ) {
          affectedAssetIds.add(asset.assetId);
        }
      }
    }
    if (affectedAssetIds.size > 0) {
      const usages = await Promise.all(
        [...affectedAssetIds].map((nodeId) =>
          window.flyoff.listProjectMediaUsages({ nodeId }),
        ),
      );
      usageCount = usages.reduce(
        (total, result) =>
          total +
          (result.ok
            ? result.value.reduce((sum, usage) => sum + usage.count, 0)
            : 0),
        0,
      );
    }
    setDeleteRequest({
      entries: selected.map(({ id: entryId, kind }) => ({ entryId, kind })),
      removedAssetIds: [...affectedAssetIds],
      usageCount,
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteRequest) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.flyoff.trashMediaEntries({
        confirmed: true,
        entries: deleteRequest.entries,
        expectedRevision: snapshot?.revision,
      });
      if (result.ok) {
        acceptSnapshot(result.value);
        onAssetsRemoved?.(deleteRequest.removedAssetIds);
        window.dispatchEvent(
          new CustomEvent(MEDIA_LIBRARY_CHANGED_EVENT, {
            detail: { removedAssetIds: deleteRequest.removedAssetIds },
          }),
        );
        setDeleteRequest(undefined);
      } else {
        onError?.(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function requestMove(entry: GalleryEntry): void {
    const selected = selection.selectedIds.has(entry.id)
      ? entries.filter((candidate) => selection.selectedIds.has(candidate.id))
      : [entry];
    setMoveRequest({
      destinationId: folderId,
      entries: selected.map(({ id: entryId, kind }) => ({ entryId, kind })),
    });
  }

  async function confirmMove(): Promise<void> {
    if (!moveRequest) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.flyoff.moveMediaEntries({
        entries: moveRequest.entries,
        expectedRevision: snapshot?.revision,
        parentId: moveRequest.destinationId,
      });
      if (result.ok) {
        acceptSnapshot(result.value);
      } else {
        onError?.(result.error.message);
      }
      setMoveRequest(undefined);
    } finally {
      setBusy(false);
    }
  }

  function moveTransferredEntries(
    event: DragEvent<HTMLElement>,
    parentId: string | null,
  ): boolean {
    const serialized = event.dataTransfer.getData(MEDIA_ENTRY_TRANSFER);
    if (!serialized) {
      return false;
    }
    event.preventDefault();
    try {
      const value = JSON.parse(serialized) as {
        projectId?: string;
        entries?: MediaGalleryEntryRef[];
        expectedRevision?: string;
      };
      if (
        value.projectId !== projectId ||
        !Array.isArray(value.entries) ||
        !canMoveMediaGalleryEntries(value.entries, parentId, snapshot)
      ) {
        return false;
      }
      setBusy(true);
      void window.flyoff
        .moveMediaEntries({
          entries: value.entries,
          expectedRevision: value.expectedRevision,
          parentId,
        })
        .then((result) => {
          if (result.ok) {
            acceptSnapshot(result.value);
          } else {
            onError?.(result.error.message);
          }
        })
        .finally(() => setBusy(false));
      return true;
    } catch {
      return false;
    }
  }

  function openEntry(entry: GalleryEntry): void {
    if (entry.kind === 'folder') {
      navigateToFolder(entry.folder.folderId);
    } else {
      onOpenAsset?.(entry.asset);
    }
  }

  function scheduleFolderHover(folder: MediaFolder): void {
    if (dropTargetId === folder.folderId && hoverFolderTimerRef.current) {
      return;
    }
    if (hoverFolderTimerRef.current) {
      clearTimeout(hoverFolderTimerRef.current);
    }
    hoverFolderTimerRef.current = setTimeout(() => {
      hoverFolderTimerRef.current = undefined;
      navigateToFolder(folder.folderId);
      setDropTargetId(null);
      // The dragged source <article> unmounts on navigation, so its
      // onDragEnd never fires — reset the ghost overlay here or it is
      // left floating on screen for the rest of the session.
      finishImageDrag();
    }, 600);
  }

  function cancelFolderHover(): void {
    if (hoverFolderTimerRef.current) {
      clearTimeout(hoverFolderTimerRef.current);
      hoverFolderTimerRef.current = undefined;
    }
  }

  function navigateToFolder(
    destinationId: string | null,
    recordHistory = true,
  ): void {
    if (destinationId === folderId) {
      return;
    }
    if (recordHistory) {
      navigationHistoryRef.current.push(folderId);
      navigationForwardRef.current = [];
    }
    updateMediaPreferences(
      {},
      {
        folderId: destinationId,
        history: navigationHistoryRef.current,
      },
    );
    setFolderId(destinationId);
    setQuery('');
    setSelection(emptyCollectionSelection());
    setFocusedId(undefined);
    setCreatingFolder(undefined);
    setEditing(undefined);
    dispatchInteraction({ type: 'finish' });
  }

  function beginCreateFolder(
    parentId = folderId,
    selectedEntries?: readonly GalleryEntry[],
  ): void {
    const draftId = `draft-folder-${crypto.randomUUID()}`;
    setCreatingFolder({
      draftId,
      entries: selectedEntries?.map(({ id: entryId, kind }) => ({
        entryId,
        kind,
      })),
      parentId,
    });
    setEditing(undefined);
    setSelection(emptyCollectionSelection());
    dispatchInteraction({ type: 'create-folder', draftId, parentId });
  }

  function beginRename(entry: GalleryEntry): void {
    setCreatingFolder(undefined);
    setEditing(entry);
    dispatchInteraction({ type: 'rename', entry });
  }

  function openQuickPreview(entry: GalleryEntry): void {
    if (entry.kind !== 'asset') {
      return;
    }
    setQuickPreviewId(entry.asset.assetId);
    dispatchInteraction({ type: 'preview', assetId: entry.asset.assetId });
  }

  function closeTransientInteraction(): boolean {
    if (creatingFolder) {
      setCreatingFolder(undefined);
      dispatchInteraction({ type: 'cancel' });
      scrollRef.current?.focus({ preventScroll: true });
      return true;
    }
    if (editing) {
      setEditing(undefined);
      dispatchInteraction({ type: 'cancel' });
      requestAnimationFrame(() => itemRefs.current.get(editing.id)?.focus());
      return true;
    }
    if (quickPreviewId) {
      setQuickPreviewId(undefined);
      dispatchInteraction({ type: 'cancel' });
      return true;
    }
    if (context) {
      setContext(undefined);
      dispatchInteraction({ type: 'cancel' });
      return true;
    }
    return false;
  }

  function contextItems(entry?: GalleryEntry): readonly MenuItem[] {
    if (!entry) {
      return [
        {
          kind: 'action',
          id: 'import',
          label: translate('projects.importMedia'),
        },
        {
          kind: 'action',
          id: 'new-folder',
          label: translate('projects.newFolder'),
        },
        { kind: 'separator', id: 'blank-media-separator' },
        {
          kind: 'submenu',
          id: 'view',
          label: translate('projects.mediaView'),
          children: viewItems,
        },
        {
          kind: 'action',
          id: 'refresh',
          label: translate('projects.refresh'),
        },
      ];
    }
    if (
      selection.selectedIds.has(entry.id) &&
      selection.selectedIds.size > 1
    ) {
      const selectedAssets = entries.filter(
        (candidate): candidate is Extract<GalleryEntry, { kind: 'asset' }> =>
          candidate.kind === 'asset' &&
          selection.selectedIds.has(candidate.id),
      );
      return [
        {
          kind: 'action',
          id: 'open-selected',
          label: translate('projects.openSelected'),
          disabled: selectedAssets.length === 0,
        },
        {
          kind: 'submenu',
          id: 'add-instance',
          label: translate('projects.addInstance'),
          children: [
            {
              kind: 'action',
              id: 'insert-selected',
              label: translate('projects.insertInActiveNote'),
              disabled: !onInsertAsset || selectedAssets.length === 0,
            },
          ],
        },
        {
          kind: 'action',
          id: 'move',
          label: translate('projects.moveSelected'),
        },
        {
          kind: 'action',
          id: 'new-folder-with-selection',
          label: translate('projects.mediaNewFolderWithSelection'),
        },
        {
          kind: 'action',
          id: 'copy-paths',
          label: translate('projects.copySelectedPaths'),
        },
        { kind: 'separator', id: 'selected-media-separator' },
        {
          kind: 'action',
          id: 'delete',
          label: translate('projects.mediaDelete'),
          tone: 'danger',
        },
      ];
    }
    return [
      ...(entry.kind === 'asset'
        ? [
            {
              kind: 'action' as const,
              id: 'preview',
              label: translate('projects.mediaQuickPreview'),
            },
            {
              kind: 'action' as const,
              id: 'open',
              label: translate('projects.mediaOpen'),
            },
            {
              kind: 'submenu' as const,
              id: 'add-instance',
              label: translate('projects.addInstance'),
              children: [
                {
                  kind: 'action' as const,
                  id: 'insert',
                  label: translate('projects.insertInActiveNote'),
                  disabled: !onInsertAsset,
                },
              ],
            },
            {
              kind: 'action' as const,
              id: 'properties',
              label: translate('projects.properties'),
            },
            { kind: 'separator' as const, id: 'asset-separator' },
          ]
        : [
            {
              kind: 'action' as const,
              id: 'open',
              label: translate('projects.mediaOpen'),
            },
            {
              kind: 'action' as const,
              id: 'import',
              label: translate('projects.importMedia'),
            },
            {
              kind: 'action' as const,
              id: 'new-folder',
              label: translate('projects.newFolder'),
            },
            {
              kind: 'action' as const,
              id: 'properties',
              label: translate('projects.properties'),
            },
            { kind: 'separator' as const, id: 'folder-separator' },
          ]),
      {
        kind: 'action',
        id: 'move',
        label: translate('projects.moveTo'),
      },
      {
        kind: 'action',
        id: 'rename',
        label: translate('projects.mediaRename'),
      },
      {
        kind: 'action',
        id: 'delete',
        label: translate('projects.mediaDelete'),
        tone: 'danger',
      },
    ];
  }

  function handleItemKeyDown(
    event: KeyboardEvent<HTMLElement>,
    entry: GalleryEntry,
  ): void {
    const index = entries.findIndex(({ id }) => id === entry.id);
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (
      event.key.length === 1 &&
      !primaryModifier &&
      !event.altKey &&
      !event.shiftKey &&
      /\S/u.test(event.key)
    ) {
      event.preventDefault();
      typeaheadRef.current += event.key.toLocaleLowerCase();
      if (typeaheadTimerRef.current) {
        clearTimeout(typeaheadTimerRef.current);
      }
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadRef.current = '';
        typeaheadTimerRef.current = undefined;
      }, 700);
      const start = Math.max(0, index + 1);
      const ordered = [...entries.slice(start), ...entries.slice(0, start)];
      const match = ordered.find((candidate) =>
        mediaGalleryEntryName(candidate)
          .toLocaleLowerCase()
          .startsWith(typeaheadRef.current),
      );
      if (match) {
        const nextIndex = entries.findIndex(({ id }) => id === match.id);
        setFocusedId(match.id);
        setSelection(selectCollectionItem(match.id));
        scrollVirtualIndex(nextIndex);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!closeTransientInteraction()) {
        setSelection(emptyCollectionSelection());
        setFocusedId(undefined);
        scrollRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (
      primaryModifier &&
      event.shiftKey &&
      event.key.toLocaleLowerCase() === 'n'
    ) {
      event.preventDefault();
      beginCreateFolder();
      return;
    }
    if (primaryModifier && event.key.toLocaleLowerCase() === 'f') {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      navigateToFolder(parentFolder?.parentId ?? null);
      return;
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      const destination = navigationHistoryRef.current.pop();
      if (destination !== undefined) {
        event.preventDefault();
        navigationForwardRef.current.push(folderId);
        navigateToFolder(destination, false);
      }
      return;
    }
    if (event.altKey && event.key === 'ArrowRight') {
      const destination = navigationForwardRef.current.pop();
      if (destination !== undefined) {
        event.preventDefault();
        navigationHistoryRef.current.push(folderId);
        navigateToFolder(destination, false);
      }
      return;
    }
    if (primaryModifier && event.key.toLocaleLowerCase() === 'a') {
      event.preventDefault();
      const next = selectAllVisibleCollectionItems(
        entries.map(({ id }) => id),
      );
      setSelection({
        anchorId: next.anchorId,
        selectedIds: next.selectedIds,
      });
      return;
    }
    if (primaryModifier && event.key === ' ') {
      event.preventDefault();
      setSelection((current) =>
        selectedForClick(current, entry.id, entries, false, true),
      );
      return;
    }
    const columns = Math.max(
      1,
      viewMode === 'grid'
        ? Math.floor((gridRef.current?.clientWidth ?? 180) / 104)
        : 1,
    );
    const pageSize = Math.max(
      columns,
      columns *
        Math.floor(
          (scrollRef.current?.clientHeight ?? 400) /
            (viewMode === 'details' ? 35 : viewMode === 'list' ? 49 : 113),
        ),
    );
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : event.key === 'ArrowLeft'
            ? index - 1
            : event.key === 'ArrowRight'
              ? index + 1
              : event.key === 'ArrowUp'
                  ? index - columns
                  : event.key === 'ArrowDown'
                    ? index + columns
                    : event.key === 'PageUp'
                      ? Math.max(0, index - pageSize)
                      : event.key === 'PageDown'
                        ? Math.min(entries.length - 1, index + pageSize)
                    : -1;
    if (nextIndex >= 0 && nextIndex < entries.length) {
      event.preventDefault();
      const next = entries[nextIndex]!;
      setFocusedId(next.id);
      if (event.shiftKey) {
        setSelection((current) =>
          selectedForClick(
            current.selectedIds.size > 0
              ? current
              : {
                  anchorId: entry.id,
                  selectedIds: new Set([entry.id]),
                },
            next.id,
            entries,
            true,
            primaryModifier,
          ),
        );
      }
      scrollVirtualIndex(nextIndex);
      requestAnimationFrame(() =>
        itemRefs.current.get(next.id)?.focus({ preventScroll: true }),
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openEntry(entry);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (entry.kind === 'asset') {
        openQuickPreview(entry);
      }
    } else if (event.key === 'F2' && selection.selectedIds.size === 1) {
      event.preventDefault();
      beginRename(entry);
    } else if (
      event.key === 'Delete' ||
      (event.key === 'Backspace' && event.metaKey)
    ) {
      event.preventDefault();
      void requestDelete(entry);
    } else if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      setContext({
        entry,
        x: bounds.left + Math.min(24, bounds.width / 2),
        y: bounds.top + Math.min(24, bounds.height / 2),
      });
    }
  }

  function handleSurfaceKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!closeTransientInteraction()) {
        setSelection(emptyCollectionSelection());
        setFocusedId(undefined);
      }
      return;
    }
    if (
      primaryModifier &&
      event.shiftKey &&
      event.key.toLocaleLowerCase() === 'n'
    ) {
      event.preventDefault();
      beginCreateFolder();
    } else if (primaryModifier && event.key.toLocaleLowerCase() === 'f') {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      navigateToFolder(parentFolder?.parentId ?? null);
    }
  }

  const parentFolder = folderId ? folderById.get(folderId) : undefined;
  const moveDestinations = moveRequest
    ? (snapshot?.folders ?? []).filter((candidate) => {
        const movedFolderIds = moveRequest.entries.flatMap((entry) =>
          entry.kind === 'folder' ? [entry.entryId] : [],
        );
        let cursor: string | null = candidate.folderId;
        while (cursor) {
          if (movedFolderIds.includes(cursor)) {
            return false;
          }
          cursor = folderById.get(cursor)?.parentId ?? null;
        }
        return true;
      })
    : [];
  const effectiveFocusId =
    (focusedId && entries.some(({ id }) => id === focusedId)
      ? focusedId
      : selection.anchorId &&
          entries.some(({ id }) => id === selection.anchorId)
        ? selection.anchorId
        : entries[0]?.id) ?? undefined;
  const marquee = useCollectionMarquee({
    disabled:
      busy ||
      Boolean(editing) ||
      interaction.type === 'creating-folder' ||
      interaction.type === 'quick-preview',
    itemRefs,
    itemSelector: '.media-gallery__item',
    getItemBounds: virtualizer.enabled
      ? virtualizer.getItemBounds
      : undefined,
    onSelectionChange: setSelection,
    scrollContainerSelector: '.media-gallery__scroll',
    selection,
    visibleNodeIds: entries.map(({ id }) => id),
  });
  const searchSuggestions: readonly SearchComposerSuggestion[] =
    MEDIA_SEARCH_SUGGESTIONS.map(([id, insertion, descriptionKey]) => ({
      description: translate(descriptionKey),
      id,
      insertion,
      label: insertion,
    }));
  const sortItems: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'name-ascending',
      label: `${translate('projects.mediaSortName')} ↑`,
      checked: sort === 'name-ascending',
    },
    {
      kind: 'action',
      id: 'name-descending',
      label: `${translate('projects.mediaSortName')} ↓`,
      checked: sort === 'name-descending',
    },
    {
      kind: 'action',
      id: 'date-newest',
      label: `${translate('projects.mediaSortDate')} ↓`,
      checked: sort === 'date-newest',
    },
    {
      kind: 'action',
      id: 'date-oldest',
      label: `${translate('projects.mediaSortDate')} ↑`,
      checked: sort === 'date-oldest',
    },
    {
      kind: 'action',
      id: 'size-largest',
      label: `${translate('projects.mediaSortSize')} ↓`,
      checked: sort === 'size-largest',
    },
    {
      kind: 'action',
      id: 'size-smallest',
      label: `${translate('projects.mediaSortSize')} ↑`,
      checked: sort === 'size-smallest',
    },
    {
      kind: 'action',
      id: 'type',
      label: translate('projects.mediaSortType'),
      checked: sort === 'type',
    },
  ];
  const activeSortLabel =
    sortItems.find(
      (item): item is Extract<MenuItem, { kind: 'action' }> =>
        item.kind === 'action' && item.id === sort,
    )?.label ?? translate('projects.mediaSort');
  const viewItems: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'grid',
      label: translate('projects.mediaViewGrid'),
      checked: viewMode === 'grid',
    },
    {
      kind: 'action',
      id: 'list',
      label: translate('projects.mediaViewList'),
      checked: viewMode === 'list',
    },
    {
      kind: 'action',
      id: 'details',
      label: translate('projects.mediaViewDetails'),
      checked: viewMode === 'details',
    },
    { kind: 'separator', id: 'view-density-separator' },
    {
      kind: 'action',
      id: 'density-compact',
      label: translate('projects.mediaDensityCompact'),
      checked: density === 'compact',
      disabled: viewMode !== 'grid',
    },
    {
      kind: 'action',
      id: 'density-normal',
      label: translate('projects.mediaDensityNormal'),
      checked: density === 'normal',
      disabled: viewMode !== 'grid',
    },
    {
      kind: 'action',
      id: 'density-large',
      label: translate('projects.mediaDensityLarge'),
      checked: density === 'large',
      disabled: viewMode !== 'grid',
    },
  ];
  const activeViewLabel =
    viewMode === 'grid'
      ? translate('projects.mediaViewGrid')
      : viewMode === 'list'
        ? translate('projects.mediaViewList')
        : translate('projects.mediaViewDetails');
  const scopeItems: readonly MenuItem[] = [
    {
      kind: 'action',
      id: 'all',
      label: translate('projects.mediaSearchAll'),
      checked: searchScope === 'all',
    },
    {
      kind: 'action',
      id: 'folder',
      label: translate('projects.mediaSearchFolder'),
      checked: searchScope === 'folder',
    },
  ];
  const selectedSize = entries.reduce(
    (total, entry) =>
      selection.selectedIds.has(entry.id) && entry.kind === 'asset'
        ? total + entry.asset.sizeBytes
        : total,
    0,
  );
  const moveDestinationItems: readonly MenuItem[] = moveRequest
    ? [
        {
          kind: 'action',
          id: 'root',
          label: translate('rail.media'),
          checked: moveRequest.destinationId === null,
        },
        ...moveDestinations.map((folder) => {
          const names = [folder.name];
          let parentId = folder.parentId;
          while (parentId) {
            const parent = folderById.get(parentId);
            if (!parent) {
              break;
            }
            names.unshift(parent.name);
            parentId = parent.parentId;
          }
          return {
            kind: 'action' as const,
            id: folder.folderId,
            label: names.join(' / '),
            checked: moveRequest.destinationId === folder.folderId,
          };
        }),
      ]
    : [];
  const moveDestinationLabel =
    moveDestinationItems.find(
      (item): item is Extract<MenuItem, { kind: 'action' }> =>
        item.kind === 'action' &&
        item.id === (moveRequest?.destinationId ?? 'root'),
    )?.label ?? translate('rail.media');

  return (
    <aside
      aria-label={translate('projects.mediaGallery')}
      className="home__sidebar media-gallery"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          (event.target instanceof Element &&
            event.target.closest(
              '.media-gallery__item, button, input, .flyoff-menu, .flyoff-dialog',
            ))
        ) {
          return;
        }
        event.preventDefault();
        setContext({ x: event.clientX, y: event.clientY });
      }}
    >
      <header className="media-gallery__header">
        <div className="media-gallery__tools">
          <button
            aria-label={translate('projects.mediaBack')}
            disabled={!folderId}
            onClick={() => {
              navigateToFolder(parentFolder?.parentId ?? null);
            }}
            type="button"
            {...getTooltipTargetProps(
              translate('projects.mediaBack'),
              'bottom',
            )}
          >
            <MaskedIcon icon={arrowLeftIcon} />
          </button>
          <button
            aria-label={translate('projects.importMedia')}
            onClick={() => void importImages()}
            type="button"
            {...getTooltipTargetProps(
              translate('projects.importMedia'),
              'bottom',
            )}
          >
            <MaskedIcon icon={plusIcon} />
          </button>
          <button
            aria-label={translate('projects.newFolder')}
            onClick={() => beginCreateFolder()}
            type="button"
            {...getTooltipTargetProps(
              translate('projects.newFolder'),
              'bottom',
            )}
          >
            <MaskedIcon icon={folderIcon} />
          </button>
          <button
            aria-label={translate('projects.refresh')}
            onClick={() => void refresh()}
            type="button"
            {...getTooltipTargetProps(translate('projects.refresh'), 'bottom')}
          >
            <MaskedIcon icon={refreshIcon} />
          </button>
        </div>
        <div className="media-gallery__breadcrumbs">
          <button
            data-drop-target={dropTargetId === null || undefined}
            onClick={() => navigateToFolder(null)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(MEDIA_ENTRY_TRANSFER)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTargetId(null);
              }
            }}
            onDrop={(event) => {
              if (moveTransferredEntries(event, null)) {
                finishImageDrag();
              }
              setDropTargetId(undefined);
            }}
            type="button"
          >
            {translate('rail.media')}
          </button>
          {breadcrumbs.map((folder) => (
            <button
              data-drop-target={dropTargetId === folder.folderId || undefined}
              key={folder.folderId}
              onClick={() => navigateToFolder(folder.folderId)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(MEDIA_ENTRY_TRANSFER)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTargetId(folder.folderId);
                }
              }}
              onDrop={(event) => {
                if (moveTransferredEntries(event, folder.folderId)) {
                  finishImageDrag();
                }
                setDropTargetId(undefined);
              }}
              type="button"
            >
              {folder.name}
            </button>
          ))}
        </div>
      </header>
      <div className="media-gallery__filters">
        <SearchComposer
          ariaLabel={translate('projects.mediaSearch')}
          inputRef={searchRef}
          onChange={(value) => {
            setQuery(value);
            setSelection(emptyCollectionSelection());
          }}
          optionsLabel={translate('projects.searchOptions')}
          placeholder={translate('projects.mediaSearch')}
          showSuggestions={preferences.workspace.showSearchTips}
          suggestions={searchSuggestions}
          value={query}
        />
        <DropdownMenu
          items={scopeItems}
          onAction={(id) => {
            const next = id as MediaGallerySearchScope;
            setSearchScope(next);
            updateMediaPreferences({ mediaGallerySearchScope: next });
          }}
          placement="bottom-end"
          trigger={(props) => (
            <button
              {...props}
              aria-label={translate('projects.mediaSearchAll')}
              className="media-gallery__scope"
              type="button"
            >
              <span>
                {searchScope === 'all'
                  ? translate('projects.mediaSearchAll')
                  : translate('projects.mediaSearchFolder')}
              </span>
              <MaskedIcon icon={chevronRightIcon} />
            </button>
          )}
        />
        <DropdownMenu
          items={sortItems}
          onAction={(id) => {
            const next = id as MediaGallerySort;
            setSort(next);
            updateMediaPreferences({ mediaGallerySort: next });
          }}
          placement="bottom-end"
          trigger={(props) => (
            <button
              {...props}
              aria-label={translate('projects.mediaSort')}
              className="media-gallery__sort"
              type="button"
            >
              <span>{activeSortLabel}</span>
              <MaskedIcon icon={chevronRightIcon} />
            </button>
          )}
        />
        <DropdownMenu
          items={viewItems}
          onAction={(id) => {
            if (id === 'grid' || id === 'list' || id === 'details') {
              setViewMode(id);
              updateMediaPreferences({ mediaGalleryView: id });
            } else if (id.startsWith('density-')) {
              const next = id.slice(
                'density-'.length,
              ) as MediaGalleryDensity;
              setDensity(next);
              updateMediaPreferences({ mediaGalleryDensity: next });
            }
          }}
          placement="bottom-end"
          trigger={(props) => (
            <button
              {...props}
              aria-label={translate('projects.mediaView')}
              className="media-gallery__view"
              type="button"
            >
              <span>{activeViewLabel}</span>
              <MaskedIcon icon={chevronRightIcon} />
            </button>
          )}
        />
      </div>
      {importProgress?.status === 'running' ? (
        <div
          aria-live="polite"
          className="media-gallery__import-progress"
          role="status"
        >
          <progress
            max={Math.max(1, importProgress.total)}
            value={importProgress.completed}
          />
          <span>
            {importProgress.completed}/{importProgress.total}
            {importProgress.currentName
              ? ` · ${importProgress.currentName}`
              : ''}
          </span>
          <button
            onClick={() => {
              const operationId = importOperationRef.current;
              if (operationId) {
                void window.flyoff.cancelProjectMediaImport({ operationId });
              }
            }}
            type="button"
          >
            {translate('projects.cancel')}
          </button>
        </div>
      ) : null}
      <div
        aria-busy={busy || undefined}
        className={`media-gallery__scroll${
          marquee.selecting ? ' project-tree--marquee-selecting' : ''
        }`}
        onContextMenu={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('.media-gallery__item')
          ) {
            return;
          }
          event.preventDefault();
          setContext({ x: event.clientX, y: event.clientY });
        }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes('Files') ||
            event.dataTransfer.types.includes(MEDIA_ENTRY_TRANSFER)
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
              MEDIA_ENTRY_TRANSFER,
            )
              ? 'move'
              : 'copy';
          }
        }}
        onDrop={(event) => {
          if (moveTransferredEntries(event, folderId)) {
            finishImageDrag();
            setDropTargetId(undefined);
            return;
          }
          if (event.dataTransfer.files.length > 0) {
            event.preventDefault();
            void importImages(Array.from(event.dataTransfer.files), folderId);
          }
          setDropTargetId(undefined);
        }}
        onKeyDown={handleSurfaceKeyDown}
        onLostPointerCapture={marquee.handleLostPointerCapture}
        onPointerCancel={marquee.handlePointerCancel}
        onPointerDown={marquee.handlePointerDown}
        onPointerMove={marquee.handlePointerMove}
        onPointerUp={marquee.handlePointerUp}
        onWheel={(event) => {
          if (!(event.ctrlKey || event.metaKey) || viewMode !== 'grid') {
            return;
          }
          event.preventDefault();
          const order: readonly MediaGalleryDensity[] = [
            'compact',
            'normal',
            'large',
          ];
          const index = order.indexOf(density);
          const next =
            order[
              Math.max(
                0,
                Math.min(
                  order.length - 1,
                  index + (event.deltaY > 0 ? -1 : 1),
                ),
              )
            ];
          if (next && next !== density) {
            setDensity(next);
            updateMediaPreferences({ mediaGalleryDensity: next });
          }
        }}
        ref={scrollRef}
        tabIndex={-1}
      >
        {error ? (
          <div className="media-gallery__message" role="alert">
            <p>{error}</p>
            <button onClick={() => void refresh()} type="button">
              {translate('projects.refresh')}
            </button>
          </div>
        ) : snapshot && entries.length === 0 ? (
          <p className="media-gallery__message">
            {translate('projects.mediaEmpty')}
          </p>
        ) : null}
        <div
          className={`media-gallery__grid media-gallery__grid--${viewMode} media-gallery__grid--${density}`}
          data-drop-root={dropTargetId === null || undefined}
          ref={gridRef}
          role="grid"
        >
          {viewMode === 'details' ? (
            <div
              aria-hidden="true"
              className="media-gallery__details-header"
              role="row"
            >
              <span>{translate('projects.name')}</span>
              <span>{translate('projects.mediaSortType')}</span>
              <span>{translate('projects.imageSizeLimits')}</span>
              <span>{translate('projects.mediaSortSize')}</span>
              <span>{translate('projects.mediaSortDate')}</span>
            </div>
          ) : null}
          {creatingFolder ? (
            <article
              aria-busy={pendingEntryId === creatingFolder.draftId || undefined}
              aria-label={translate('projects.mediaFolderName')}
              aria-selected="true"
              className="media-gallery__item media-gallery__item--folder media-gallery__item--draft"
              role="gridcell"
            >
              <div className="media-gallery__folder">
                <MaskedIcon icon={folderIcon} />
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = String(
                    new FormData(event.currentTarget).get('name') ?? '',
                  ).trim();
                  if (name) {
                    void createFolder(name);
                  } else {
                    setCreatingFolder(undefined);
                    dispatchInteraction({ type: 'cancel' });
                  }
                }}
              >
                <input
                  aria-label={translate('projects.mediaFolderName')}
                  autoFocus
                  defaultValue={translate('projects.mediaNewFolderDefault')}
                  name="name"
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim();
                    if (name) {
                      void createFolder(name);
                    } else {
                      setCreatingFolder(undefined);
                      dispatchInteraction({ type: 'cancel' });
                    }
                  }}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setCreatingFolder(undefined);
                      dispatchInteraction({ type: 'cancel' });
                      scrollRef.current?.focus({ preventScroll: true });
                    }
                  }}
                />
              </form>
            </article>
          ) : null}
          {virtualizer.topSpacerHeight > 0 ? (
            <div
              aria-hidden="true"
              className="media-gallery__virtual-spacer"
              style={{ height: virtualizer.topSpacerHeight }}
            />
          ) : null}
          {renderedEntries.map((entry) => {
            const selected = selection.selectedIds.has(entry.id);
            const name = mediaGalleryEntryName(entry);
            return (
              <article
                aria-label={name}
                aria-busy={pendingEntryId === entry.id || undefined}
                aria-selected={selected}
                className={`media-gallery__item media-gallery__item--${entry.kind}${
                  dropTargetId === entry.id
                    ? ' media-gallery__item--drop-target'
                    : ''
                }`}
                draggable
                key={entry.id}
                onClick={(event) => {
                  setFocusedId(entry.id);
                  setSelection((current) =>
                    selectedForClick(
                      current,
                      entry.id,
                      entries,
                      event.shiftKey,
                      event.ctrlKey || event.metaKey,
                    ),
                  );
                }}
                onPointerDown={(event) => {
                  if (
                    event.button === 0 &&
                    !event.shiftKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !selected
                  ) {
                    setFocusedId(entry.id);
                    setSelection(selectCollectionItem(entry.id));
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selected) {
                    setSelection({
                      anchorId: entry.id,
                      selectedIds: new Set([entry.id]),
                    });
                  }
                  setContext({
                    entry,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onDoubleClick={() => openEntry(entry)}
                onFocus={() => setFocusedId(entry.id)}
                onDragOver={(event) => {
                  if (
                    entry.kind === 'folder' &&
                    (event.dataTransfer.types.includes(MEDIA_ENTRY_TRANSFER) ||
                      event.dataTransfer.types.includes('Files'))
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const draggedEntries =
                      interaction.type === 'dragging'
                        ? interaction.entryIds.flatMap((entryId) => {
                            const dragged = entries.find(
                              ({ id }) => id === entryId,
                            );
                            return dragged
                              ? [{ entryId, kind: dragged.kind }]
                              : [];
                          })
                        : [];
                    if (
                      draggedEntries.length > 0 &&
                      !canMoveMediaGalleryEntries(
                        draggedEntries,
                        entry.folder.folderId,
                        snapshot,
                      )
                    ) {
                      event.dataTransfer.dropEffect = 'none';
                      cancelFolderHover();
                      setDropTargetId(undefined);
                      return;
                    }
                    event.dataTransfer.dropEffect =
                      event.dataTransfer.types.includes(MEDIA_ENTRY_TRANSFER)
                        ? 'move'
                        : 'copy';
                    setDropTargetId(entry.id);
                    if (
                      event.dataTransfer.types.includes(MEDIA_ENTRY_TRANSFER)
                    ) {
                      scheduleFolderHover(entry.folder);
                    }
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    entry.kind === 'folder' &&
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    setDropTargetId((current) =>
                      current === entry.id ? undefined : current,
                    );
                    cancelFolderHover();
                  }
                }}
                onDragStart={(event: DragEvent<HTMLElement>) => {
                  const selectedEntries = selection.selectedIds.has(entry.id)
                    ? entries.filter(({ id }) =>
                        selection.selectedIds.has(id),
                      )
                    : [entry];
                  dispatchInteraction({
                    type: 'drag',
                    entryIds: selectedEntries.map(({ id }) => id),
                  });
                  event.dataTransfer.effectAllowed =
                    entry.kind === 'asset' ? 'copyMove' : 'move';
                  event.dataTransfer.setData(
                    MEDIA_ENTRY_TRANSFER,
                    JSON.stringify({
                      projectId,
                      entries: selectedEntries.map(
                        ({ id: entryId, kind }) => ({ entryId, kind }),
                      ),
                      expectedRevision: snapshot?.revision,
                    }),
                  );
                  if (
                    entry.kind === 'asset' &&
                    selectedEntries.length === 1 &&
                    selectedEntries.every(
                      (candidate) => candidate.kind === 'asset',
                    )
                  ) {
                    const naturalWidth = entry.asset.pixelWidth ?? 640;
                    const naturalHeight = entry.asset.pixelHeight ?? 360;
                    const targetWidth = Math.min(
                      640,
                      Math.max(96, naturalWidth),
                    );
                    const targetHeight = Math.max(
                      24,
                      Math.round(
                        targetWidth * (naturalHeight / naturalWidth),
                      ),
                    );
                    const ghostScale = Math.min(
                      1,
                      180 / targetWidth,
                      140 / targetHeight,
                    );
                    const instanceId = crypto.randomUUID();
                    const image =
                      event.currentTarget.querySelector<HTMLImageElement>(
                        'img',
                      );
                    const sourceBounds =
                      image?.getBoundingClientRect() ??
                      event.currentTarget.getBoundingClientRect();
                    const sourceUrl = mediaAssetUrl(
                      entry.asset.assetId,
                      projectId,
                      entry.asset.revision,
                    );
                    event.dataTransfer.setData(
                      MEDIA_ASSET_TRANSFER,
                      JSON.stringify({
                        projectId,
                        assetId: entry.asset.assetId,
                        ghostHeight: targetHeight * ghostScale,
                        ghostWidth: targetWidth * ghostScale,
                        instanceId,
                        sourceUrl,
                        targetHeight,
                        targetWidth,
                      }),
                    );
                    event.dataTransfer.setData('text/plain', name);
                    transparentNativeDragImage(event.dataTransfer);
                    beginImageDrag(
                      {
                        assetId: entry.asset.assetId,
                        ghostHeight: targetHeight * ghostScale,
                        ghostWidth: targetWidth * ghostScale,
                        instanceId,
                        projectId,
                        source: 'gallery',
                        sourceUrl,
                        targetHeight,
                        targetWidth,
                      },
                      {
                        x:
                          event.clientX ||
                          sourceBounds.left + sourceBounds.width / 2,
                        y:
                          event.clientY ||
                          sourceBounds.top + sourceBounds.height / 2,
                      },
                      {
                        height: sourceBounds.height,
                        left: sourceBounds.left,
                        top: sourceBounds.top,
                        width: sourceBounds.width,
                      },
                    );
                  }
                }}
                onDrag={(event) => {
                  if (
                    entry.kind === 'asset' &&
                    (event.clientX !== 0 || event.clientY !== 0)
                  ) {
                    moveImageDrag({ x: event.clientX, y: event.clientY });
                  }
                }}
                onDragEnd={() => {
                  cancelFolderHover();
                  setDropTargetId(undefined);
                  dispatchInteraction({ type: 'finish' });
                  if (entry.kind === 'asset') {
                    returnImageDrag();
                  }
                }}
                onDrop={(event) => {
                  if (entry.kind !== 'folder') {
                    return;
                  }
                  if (
                    moveTransferredEntries(event, entry.folder.folderId)
                  ) {
                    event.stopPropagation();
                    finishImageDrag();
                  } else if (event.dataTransfer.files.length > 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    void importImages(
                      Array.from(event.dataTransfer.files),
                      entry.folder.folderId,
                    );
                  }
                  setDropTargetId(undefined);
                  cancelFolderHover();
                }}
                onKeyDown={(event) => handleItemKeyDown(event, entry)}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(entry.id, element);
                  } else {
                    itemRefs.current.delete(entry.id);
                  }
                }}
                role="gridcell"
                tabIndex={effectiveFocusId === entry.id ? 0 : -1}
              >
                {entry.kind === 'folder' ? (
                  <div className="media-gallery__folder">
                    <MaskedIcon icon={folderIcon} />
                  </div>
                ) : (
                  <img
                    alt=""
                    decoding="async"
                    draggable={false}
                    loading="lazy"
                    src={mediaAssetUrl(
                      entry.asset.assetId,
                      projectId,
                      entry.asset.revision,
                    )}
                  />
                )}
                {editing?.id === entry.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = String(
                        new FormData(event.currentTarget).get('name') ?? '',
                      ).trim();
                      if (name) {
                        void renameEntry(entry, name);
                      }
                    }}
                  >
                    <input
                      aria-label={translate('projects.name')}
                      autoFocus
                      defaultValue={
                        entry.kind === 'folder'
                          ? entry.folder.name
                          : entry.asset.name
                      }
                      name="name"
                      onBlur={(event) => {
                        const name = event.currentTarget.value.trim();
                        if (name) {
                          void renameEntry(entry, name);
                        } else {
                          setEditing(undefined);
                          dispatchInteraction({ type: 'cancel' });
                        }
                      }}
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditing(undefined);
                          dispatchInteraction({ type: 'cancel' });
                          requestAnimationFrame(() =>
                            itemRefs.current.get(entry.id)?.focus(),
                          );
                        }
                      }}
                    />
                  </form>
                ) : (
                  <span className="media-gallery__name">{name}</span>
                )}
                {viewMode !== 'grid' ? (
                  <>
                    <span className="media-gallery__path">
                      {entry.path ?? name}
                    </span>
                    <span className="media-gallery__type">
                      {entry.kind === 'folder'
                        ? translate('projects.mediaFolderType')
                        : entry.asset.extension.replace(/^\./u, '').toUpperCase()}
                    </span>
                    <span className="media-gallery__dimensions">
                      {entry.kind === 'asset'
                        ? formatMediaDimensions(entry.asset)
                        : '—'}
                    </span>
                    <span className="media-gallery__size">
                      {entry.kind === 'asset'
                        ? formatMediaBytes(entry.asset.sizeBytes)
                        : '—'}
                    </span>
                    <span className="media-gallery__modified">
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'short',
                      }).format(
                        new Date(
                          entry.kind === 'folder'
                            ? entry.folder.modifiedAt
                            : entry.asset.modifiedAt,
                        ),
                      )}
                    </span>
                  </>
                ) : null}
              </article>
            );
          })}
          {virtualizer.bottomSpacerHeight > 0 ? (
            <div
              aria-hidden="true"
              className="media-gallery__virtual-spacer"
              style={{ height: virtualizer.bottomSpacerHeight }}
            />
          ) : null}
        </div>
        {marquee.boxStyle ? (
          <div
            aria-hidden="true"
            className="project-tree__marquee"
            style={marquee.boxStyle}
          />
        ) : null}
      </div>
      {selection.selectedIds.size > 0 ? (
        <footer className="media-gallery__selection">
          <span>
            {selection.selectedIds.size} {translate('projects.mediaSelected')}
          </span>
          {selectedSize > 0 ? <span>{formatMediaBytes(selectedSize)}</span> : null}
        </footer>
      ) : null}
      {context ? (
        <ContextMenu
          ariaLabel={translate('projects.moreActions')}
          items={contextItems(context.entry)}
          onAction={(action) => {
            const entry = context.entry;
            setContext(undefined);
            if (action === 'import') {
              void importImages(
                undefined,
                entry?.kind === 'folder' ? entry.folder.folderId : folderId,
              );
            } else if (action === 'new-folder') {
              if (entry?.kind === 'folder') {
                navigateToFolder(entry.folder.folderId);
                beginCreateFolder(entry.folder.folderId);
              } else {
                beginCreateFolder();
              }
            } else if (
              action === 'grid' ||
              action === 'list' ||
              action === 'details'
            ) {
              setViewMode(action);
              updateMediaPreferences({ mediaGalleryView: action });
            } else if (action.startsWith('density-')) {
              const next = action.slice(
                'density-'.length,
              ) as MediaGalleryDensity;
              setDensity(next);
              updateMediaPreferences({ mediaGalleryDensity: next });
            } else if (action === 'refresh') {
              void refresh();
            } else if (action === 'new-folder-with-selection') {
              beginCreateFolder(
                folderId,
                entries.filter(({ id }) => selection.selectedIds.has(id)),
              );
            } else if (!entry) {
              return;
            } else if (action === 'open') {
              openEntry(entry);
            } else if (action === 'preview') {
              openQuickPreview(entry);
            } else if (action === 'insert' && entry.kind === 'asset') {
              onInsertAsset?.(entry.asset);
            } else if (action === 'insert-selected') {
              for (const selectedEntry of entries) {
                if (
                  selectedEntry.kind === 'asset' &&
                  selection.selectedIds.has(selectedEntry.id)
                ) {
                  onInsertAsset?.(selectedEntry.asset);
                }
              }
            } else if (action === 'open-selected') {
              for (const selectedEntry of entries) {
                if (
                  selectedEntry.kind === 'asset' &&
                  selection.selectedIds.has(selectedEntry.id)
                ) {
                  onOpenAsset?.(selectedEntry.asset);
                }
              }
            } else if (action === 'move') {
              requestMove(entry);
            } else if (action === 'copy-paths') {
              const paths = entries.flatMap((selectedEntry) => {
                if (!selection.selectedIds.has(selectedEntry.id)) {
                  return [];
                }
                if (selectedEntry.kind === 'asset') {
                  return [selectedEntry.asset.relativePath];
                }
                const names = [selectedEntry.folder.name];
                let parentId = selectedEntry.folder.parentId;
                while (parentId) {
                  const parent = folderById.get(parentId);
                  if (!parent) {
                    break;
                  }
                  names.unshift(parent.name);
                  parentId = parent.parentId;
                }
                return [`Media/${names.join('/')}`];
              });
              void navigator.clipboard.writeText(paths.join('\n'));
            } else if (action === 'properties') {
              if (entry.kind === 'asset') {
                setProperties({ asset: entry.asset });
                void window.flyoff
                  .listProjectMediaUsages({ nodeId: entry.asset.assetId })
                  .then((result) => {
                    if (result.ok) {
                      setProperties((current) =>
                        current?.asset.assetId === entry.asset.assetId
                          ? {
                              ...current,
                              usages: result.value.reduce(
                                (sum, usage) => sum + usage.count,
                                0,
                              ),
                            }
                          : current,
                      );
                    }
                  });
              } else {
                const descendantFolders = new Set([entry.folder.folderId]);
                let changed = true;
                while (changed) {
                  changed = false;
                  for (const folder of snapshot?.folders ?? []) {
                    if (
                      folder.parentId &&
                      descendantFolders.has(folder.parentId) &&
                      !descendantFolders.has(folder.folderId)
                    ) {
                      descendantFolders.add(folder.folderId);
                      changed = true;
                    }
                  }
                }
                const assets = (snapshot?.assets ?? []).filter(
                  ({ folderId: assetFolderId }) =>
                    assetFolderId !== null &&
                    descendantFolders.has(assetFolderId),
                );
                setFolderProperties({
                  assetCount: assets.length,
                  folder: entry.folder,
                  folderCount: descendantFolders.size - 1,
                  path: entry.path ?? `Media/${entry.folder.name}`,
                  sizeBytes: assets.reduce(
                    (total, asset) => total + asset.sizeBytes,
                    0,
                  ),
                });
              }
            } else if (action === 'rename') {
              beginRename(entry);
            } else if (action === 'delete') {
              void requestDelete(entry);
            }
          }}
          onClose={() => setContext(undefined)}
          x={context.x}
          y={context.y}
        />
      ) : null}
      {quickPreviewAsset ? (
        <Dialog
          bodyPadding="none"
          className="media-gallery__quick-preview"
          closeLabel={translate('windowControls.close')}
          onCancel={() => {
            setQuickPreviewId(undefined);
            dispatchInteraction({ type: 'cancel' });
          }}
          size="wide"
          title={`${quickPreviewAsset.name}${quickPreviewAsset.extension}`}
        >
          <div className="media-gallery__quick-preview-stage">
            <img
              alt={quickPreviewAsset.name}
              draggable={false}
              src={mediaAssetUrl(
                quickPreviewAsset.assetId,
                projectId,
                quickPreviewAsset.revision,
              )}
            />
          </div>
        </Dialog>
      ) : null}
      {deleteRequest ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          description={
            deleteRequest.usageCount > 0
              ? `Esta imagem aparece ${deleteRequest.usageCount} vez(es) em notas. As referências serão mantidas como mídia ausente.`
              : undefined
          }
          onCancel={() => setDeleteRequest(undefined)}
          title={translate('projects.deleteTitle')}
          footerEnd={
            <>
              <button onClick={() => setDeleteRequest(undefined)} type="button">
                {translate('projects.cancel')}
              </button>
              <button
                className="flyoff-dialog__danger"
                disabled={busy}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {translate('projects.delete')}
              </button>
            </>
          }
        />
      ) : null}
      {moveRequest ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          footerEnd={
            <>
              <button onClick={() => setMoveRequest(undefined)} type="button">
                {translate('projects.cancel')}
              </button>
              <button
                disabled={busy}
                onClick={() => void confirmMove()}
                type="button"
              >
                {translate('projects.moveTo')}
              </button>
            </>
          }
          onCancel={() => setMoveRequest(undefined)}
          title={translate('projects.moveTo')}
        >
          <DropdownMenu
            items={moveDestinationItems}
            onAction={(id) =>
              setMoveRequest((current) =>
                current
                  ? {
                      ...current,
                      destinationId: id === 'root' ? null : id,
                    }
                  : current,
              )
            }
            trigger={(props) => (
              <button
                {...props}
                aria-label={translate('projects.moveTo')}
                autoFocus
                className="media-gallery__move-target"
                type="button"
              >
                <span>{moveDestinationLabel}</span>
                <MaskedIcon icon={chevronRightIcon} />
              </button>
            )}
          />
        </Dialog>
      ) : null}
      {properties ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          footerEnd={
            <button onClick={() => setProperties(undefined)} type="button">
              {translate('windowControls.close')}
            </button>
          }
          onCancel={() => setProperties(undefined)}
          title={translate('projects.properties')}
        >
          <dl className="media-gallery__properties">
            <div>
              <dt>{translate('projects.name')}</dt>
              <dd>
                {properties.asset.name}
                {properties.asset.extension}
              </dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesType')}</dt>
              <dd>{properties.asset.mimeType}</dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesContentSize')}</dt>
              <dd>{properties.asset.sizeBytes.toLocaleString()} B</dd>
            </div>
            {properties.asset.pixelWidth && properties.asset.pixelHeight ? (
              <div>
                <dt>{translate('projects.imageSizeLimits')}</dt>
                <dd>
                  {properties.asset.pixelWidth} × {properties.asset.pixelHeight}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{translate('projects.location')}</dt>
              <dd>{properties.asset.relativePath}</dd>
            </div>
            <div>
              <dt>{translate('projects.imageUsages')}</dt>
              <dd>{properties.usages ?? '—'}</dd>
            </div>
          </dl>
        </Dialog>
      ) : null}
      {folderProperties ? (
        <Dialog
          closeLabel={translate('windowControls.close')}
          footerEnd={
            <button onClick={() => setFolderProperties(undefined)} type="button">
              {translate('windowControls.close')}
            </button>
          }
          onCancel={() => setFolderProperties(undefined)}
          title={translate('projects.properties')}
        >
          <dl className="media-gallery__properties">
            <div>
              <dt>{translate('projects.name')}</dt>
              <dd>{folderProperties.folder.name}</dd>
            </div>
            <div>
              <dt>{translate('projects.location')}</dt>
              <dd>{folderProperties.path}</dd>
            </div>
            <div>
              <dt>{translate('projects.mediaSubfolders')}</dt>
              <dd>{folderProperties.folderCount}</dd>
            </div>
            <div>
              <dt>{translate('projects.mediaImages')}</dt>
              <dd>{folderProperties.assetCount}</dd>
            </div>
            <div>
              <dt>{translate('projects.propertiesContentSize')}</dt>
              <dd>{formatMediaBytes(folderProperties.sizeBytes)}</dd>
            </div>
          </dl>
        </Dialog>
      ) : null}
    </aside>
  );
});

export { MEDIA_ASSET_TRANSFER, MEDIA_ENTRY_TRANSFER } from './media-transfer';
