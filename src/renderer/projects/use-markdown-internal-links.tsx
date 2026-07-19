import { useRef, useState } from 'react';

import {
  extractInternalLinks,
  type InternalLinkOccurrence,
} from '../../shared/markdown';
import type {
  ProjectInternalLinkRequest,
  ProjectInternalLinkTarget,
  ProjectLinkTarget,
} from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import {
  SOURCE_MENU_ACTION,
} from './MarkdownSourceContextMenu';
import {
  MarkdownInternalLinkOverlays,
  type InternalLinkChooserState,
  type InternalLinkPreviewState,
  type InternalLinkReferencesState,
  type InternalLinkRenameState,
  type InternalLinkReplaceState,
} from './MarkdownInternalLinkOverlays';
import type { MarkdownLinkRuntime } from './project-page-type-registry';
import type {
  SourceContextEdit,
  SourceContextLink,
  SourceMenuRequest,
} from './source-context-actions';
import type { SourceSelection } from './source-caret';

type InternalLinkAction =
  | typeof SOURCE_MENU_ACTION.changeAllOccurrences
  | typeof SOURCE_MENU_ACTION.findReferences
  | typeof SOURCE_MENU_ACTION.goToDefinition
  | typeof SOURCE_MENU_ACTION.peekDefinition
  | typeof SOURCE_MENU_ACTION.renameSymbol;

interface PendingAction {
  action: InternalLinkAction;
  link: SourceContextLink;
  position: { x: number; y: number };
  selection: SourceSelection;
}

interface ReplaceContext {
  links: readonly InternalLinkOccurrence[];
  selection: SourceSelection;
  source: ProjectLinkTarget;
}

interface UseMarkdownInternalLinksOptions {
  content: string;
  nodeId: string;
  onCommit: (
    edit: SourceContextEdit,
    beforeSelection: SourceSelection,
    inputType: string,
  ) => void;
  onError?: (message: string) => void;
  runtime?: MarkdownLinkRuntime;
  translate: Translate;
}

function requestFor(
  nodeId: string,
  link: Pick<
    SourceContextLink,
    'headingPath' | 'path' | 'syntax'
  >,
): ProjectInternalLinkRequest {
  return {
    headingPath: link.headingPath,
    path: link.path,
    sourceNodeId: nodeId,
    syntax: link.syntax,
  };
}

function pathSegments(value: string): string[] {
  return value.split('/').filter(Boolean);
}

function relativePath(from: string, to: string): string {
  const source = pathSegments(from);
  source.pop();
  const target = pathSegments(to);
  while (
    source.length > 0 &&
    target.length > 0 &&
    source[0]!.toLocaleLowerCase() === target[0]!.toLocaleLowerCase()
  ) {
    source.shift();
    target.shift();
  }
  const result = [
    ...Array.from({ length: source.length }, () => '..'),
    ...target,
  ].join('/');
  return result || target.at(-1) || '';
}

function encodedMarkdownPath(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function replacementDestination(
  link: InternalLinkOccurrence,
  source: ProjectLinkTarget,
  target: ProjectLinkTarget,
  targets: readonly ProjectLinkTarget[],
): string {
  const hashAt = link.destination.indexOf('#');
  const fragment = hashAt === -1 ? '' : link.destination.slice(hashAt);
  const hadExtension = /\.md(?:#|$)/i.test(link.destination);
  let destination: string;

  if (link.syntax === 'wikilink') {
    const uniqueName =
      targets.filter(
        (candidate) =>
          candidate.name.toLocaleLowerCase() ===
          target.name.toLocaleLowerCase(),
      ).length === 1;
    destination =
      !link.path.includes('/') && uniqueName ? target.name : target.path;
    if (hadExtension) {
      destination += '.md';
    }
    return `${destination}${fragment}`;
  }

  const rootBased = link.path.startsWith('/');
  destination = rootBased
    ? `/${target.path}`
    : relativePath(source.path, target.path);
  if (hadExtension) {
    destination += '.md';
  }
  return `${encodedMarkdownPath(destination)}${fragment}`;
}

function adjustedSelection(
  selection: SourceSelection,
  replacements: readonly {
    end: number;
    start: number;
    value: string;
  }[],
): SourceSelection {
  const adjust = (offset: number): number => {
    let next = offset;
    for (const replacement of replacements) {
      if (replacement.end <= offset) {
        next += replacement.value.length - (replacement.end - replacement.start);
      } else if (replacement.start < offset) {
        next = replacement.start + replacement.value.length;
      }
    }
    return next;
  };
  return {
    direction: selection.direction,
    end: adjust(selection.end),
    start: adjust(selection.start),
  };
}

export function useMarkdownInternalLinks({
  content,
  nodeId,
  onCommit,
  onError,
  runtime,
  translate,
}: UseMarkdownInternalLinksOptions) {
  const [chooser, setChooser] = useState<InternalLinkChooserState>();
  const [preview, setPreview] = useState<InternalLinkPreviewState>();
  const [references, setReferences] =
    useState<InternalLinkReferencesState>();
  const [rename, setRename] = useState<InternalLinkRenameState>();
  const [replace, setReplace] = useState<InternalLinkReplaceState>();
  const pendingActionRef = useRef<PendingAction | undefined>(undefined);
  const replaceContextRef = useRef<ReplaceContext | undefined>(undefined);

  function report(message?: string): void {
    onError?.(message ?? translate('projects.operationFailed'));
  }

  async function perform(
    pending: PendingAction,
    target: ProjectInternalLinkTarget,
  ): Promise<void> {
    if (!runtime) {
      report();
      return;
    }

    switch (pending.action) {
      case SOURCE_MENU_ACTION.goToDefinition:
        await runtime.openTarget(target);
        return;
      case SOURCE_MENU_ACTION.peekDefinition: {
        setPreview({
          loading: !target.locked,
          locked: target.locked,
          position: pending.position,
          target,
        });
        if (target.locked) {
          return;
        }
        try {
          const result = await window.flyoff.readMarkdownDocument({
            nodeId: target.nodeId,
          });
          setPreview((current) =>
            current?.target.nodeId === target.nodeId
              ? result.ok
                ? { ...current, content: result.value.content, loading: false }
                : {
                    ...current,
                    error: result.error.message,
                    loading: false,
                  }
              : current,
          );
        } catch (error) {
          setPreview((current) =>
            current?.target.nodeId === target.nodeId
              ? { ...current, error: String(error), loading: false }
              : current,
          );
        }
        return;
      }
      case SOURCE_MENU_ACTION.findReferences: {
        setReferences({ loading: true, target });
        const result = await runtime.listBacklinks({
          targetNodeId: target.nodeId,
        });
        if (!result.ok) {
          setReferences(undefined);
          report(result.error.message);
          return;
        }
        setReferences({ loading: false, outcome: result.value, target });
        return;
      }
      case SOURCE_MENU_ACTION.renameSymbol:
        setRename({ busy: false, name: target.name, target });
        return;
      case SOURCE_MENU_ACTION.changeAllOccurrences: {
        const targetsResult = await runtime.listTargets();
        if (!targetsResult.ok) {
          report(targetsResult.error.message);
          return;
        }
        const source = targetsResult.value.find(
          (candidate) => candidate.nodeId === nodeId,
        );
        if (!source) {
          report();
          return;
        }
        const occurrences = extractInternalLinks(content);
        const resolutions = await Promise.all(
          occurrences.map((occurrence) =>
            runtime.resolve({
              headingPath: occurrence.headingPath,
              path: occurrence.path,
              sourceNodeId: nodeId,
              syntax: occurrence.syntax,
            }),
          ),
        );
        const matching = occurrences.filter((_, index) => {
          const result = resolutions[index];
          return (
            result?.ok &&
            result.value.status === 'resolved' &&
            result.value.target.nodeId === target.nodeId
          );
        });
        if (matching.length === 0) {
          report(translate('projects.internalLinkMissing'));
          return;
        }
        replaceContextRef.current = {
          links: matching,
          selection: pending.selection,
          source,
        };
        setReplace({
          busy: false,
          count: matching.length,
          currentTarget: target,
          query: '',
          targets: targetsResult.value,
        });
      }
    }
  }

  async function execute(
    action: InternalLinkAction,
    context: SourceMenuRequest,
  ): Promise<void> {
    if (!runtime || !context.link?.internal) {
      report();
      return;
    }
    const pending: PendingAction = {
      action,
      link: context.link,
      position: context.position,
      selection: context.selection,
    };
    const result = await runtime.resolve(requestFor(nodeId, context.link));
    if (!result.ok) {
      report(result.error.message);
      return;
    }
    if (result.value.status === 'missing') {
      report(translate('projects.internalLinkMissing'));
      return;
    }
    if (result.value.status === 'ambiguous') {
      pendingActionRef.current = pending;
      setChooser({ candidates: result.value.candidates });
      return;
    }
    await perform(pending, result.value.target);
  }

  async function executeRequest(
    action: InternalLinkAction,
    request: ProjectInternalLinkRequest,
    position: { x: number; y: number },
  ): Promise<void> {
    if (!runtime) {
      report();
      return;
    }
    const link: SourceContextLink = {
      end: 0,
      headingPath: request.headingPath,
      internal: true,
      path: request.path,
      start: 0,
      syntax: request.syntax,
      url: request.path,
    };
    const pending: PendingAction = {
      action,
      link,
      position,
      selection: { direction: 'none', end: 0, start: 0 },
    };
    const result = await runtime.resolve(request);
    if (!result.ok) {
      report(result.error.message);
      return;
    }
    if (result.value.status === 'missing') {
      report(translate('projects.internalLinkMissing'));
      return;
    }
    if (result.value.status === 'ambiguous') {
      pendingActionRef.current = pending;
      setChooser({ candidates: result.value.candidates });
      return;
    }
    await perform(pending, result.value.target);
  }

  async function chooseCandidate(target: ProjectLinkTarget): Promise<void> {
    const pending = pendingActionRef.current;
    setChooser(undefined);
    pendingActionRef.current = undefined;
    if (!runtime || !pending) {
      return;
    }
    const result = await runtime.resolve({
      headingPath: pending.link.headingPath,
      path: `/${target.path}.md`,
      sourceNodeId: nodeId,
      syntax: 'markdown',
    });
    if (!result.ok || result.value.status !== 'resolved') {
      report(result.ok ? translate('projects.internalLinkMissing') : result.error.message);
      return;
    }
    await perform(pending, result.value.target);
  }

  async function submitRename(): Promise<void> {
    if (!runtime || !rename || rename.busy) {
      return;
    }
    const name = rename.name.trim();
    setRename({ ...rename, busy: true, error: undefined });
    const result = await runtime.renameTarget(rename.target.nodeId, name);
    if (!result.ok) {
      setRename({ ...rename, busy: false, error: result.error.message });
      return;
    }
    setRename(undefined);
  }

  function replaceTarget(target: ProjectLinkTarget): void {
    const context = replaceContextRef.current;
    if (!replace || !context) {
      return;
    }
    const replacements = context.links
      .map((link) => ({
        end: link.destinationEnd,
        start: link.destinationStart,
        value: replacementDestination(
          link,
          context.source,
          target,
          replace.targets,
        ),
      }))
      .sort((left, right) => left.start - right.start);
    let nextContent = content;
    for (const replacement of [...replacements].reverse()) {
      nextContent =
        nextContent.slice(0, replacement.start) +
        replacement.value +
        nextContent.slice(replacement.end);
    }
    onCommit(
      {
        content: nextContent,
        selection: adjustedSelection(context.selection, replacements),
      },
      context.selection,
      'context:change-link-occurrences',
    );
    replaceContextRef.current = undefined;
    setReplace(undefined);
  }

  const overlays = (
    <MarkdownInternalLinkOverlays
      chooser={chooser}
      onChooseCandidate={(target) => void chooseCandidate(target)}
      onCloseChooser={() => {
        pendingActionRef.current = undefined;
        setChooser(undefined);
      }}
      onClosePreview={() => setPreview(undefined)}
      onCloseReferences={() => setReferences(undefined)}
      onCloseRename={() => setRename(undefined)}
      onCloseReplace={() => {
        replaceContextRef.current = undefined;
        setReplace(undefined);
      }}
      onOpenPreview={() => {
        if (preview && runtime) {
          void runtime.openTarget(preview.target);
        }
        setPreview(undefined);
      }}
      onOpenReference={(target, offset) => {
        if (runtime) {
          void runtime.openTarget(target, { headingPath: [], offset });
        }
        setReferences(undefined);
      }}
      onRenameNameChange={(name) =>
        setRename((current) => (current ? { ...current, name } : current))
      }
      onRenameSubmit={() => void submitRename()}
      onReplaceQueryChange={(query) =>
        setReplace((current) => (current ? { ...current, query } : current))
      }
      onReplaceTarget={replaceTarget}
      preview={preview}
      references={references}
      rename={rename}
      replace={replace}
      translate={translate}
    />
  );

  return { execute, executeRequest, overlays };
}
