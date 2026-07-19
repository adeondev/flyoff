import { useEffect, useState, type ComponentType } from 'react';

import checklistIcon from '../../../public/images/icons/instances/checklist.svg';
import galleryIcon from '../../../public/images/icons/instances/image-solid.svg';
import markdownPageIcon from '../../../public/images/icons/instances/note-solid.svg';
import kanbanIcon from '../../../public/images/icons/instances/table.svg';
import type {
  MarkdownDocument,
  ListProjectBacklinksRequest,
  PageSessionState,
  ProjectBacklinksOutcome,
  ProjectInternalLinkRequest,
  ProjectInternalLinkResolution,
  ProjectInternalLinkTarget,
  ProjectLinkTarget,
  ProjectPageNode,
  ProjectResult,
} from '../../shared/contracts';
import { isProjectInstanceTypeId } from '../../shared/contracts';
import type { TranslationKey } from '../../shared/i18n/catalogs';
import type { Translate } from '../pages/page-types';
import { useFlyoffPreferences } from '../preferences';
import {
  readEditorMode,
  updateEditorModeState,
} from './editor-mode';
import type { MarkdownDocumentController } from './markdown-document-controller';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownLockedView } from './MarkdownLockedView';
import { projectNodeDisplayName } from './project-node-name';

export interface MarkdownPageRuntime {
  controller: MarkdownDocumentController;
  lockedNodeIds: ReadonlySet<string>;
  onPasswordRequired: (nodeId: string) => void;
  readDocument: (
    nodeId: string,
  ) => Promise<ProjectResult<MarkdownDocument>>;
  unlockDocument: (
    nodeId: string,
    password: string,
  ) => Promise<ProjectResult<MarkdownDocument>>;
  links: MarkdownLinkRuntime;
  navigation?: MarkdownLinkNavigation;
}

export interface MarkdownLinkNavigation {
  headingPath: readonly string[];
  nodeId: string;
  offset?: number;
  requestId: number;
}

export interface MarkdownLinkRuntime {
  listBacklinks: (
    request: ListProjectBacklinksRequest,
  ) => Promise<ProjectResult<ProjectBacklinksOutcome>>;
  listTargets: () => Promise<ProjectResult<readonly ProjectLinkTarget[]>>;
  openTarget: (
    target: ProjectInternalLinkTarget | ProjectLinkTarget,
    navigation?: { headingPath: readonly string[]; offset?: number },
  ) => Promise<void>;
  resolve: (
    request: ProjectInternalLinkRequest,
  ) => Promise<ProjectResult<ProjectInternalLinkResolution>>;
  renameTarget: (
    nodeId: string,
    name: string,
  ) => Promise<ProjectResult<ProjectPageNode>>;
}

export interface ProjectPageRuntime {
  markdown: MarkdownPageRuntime;
  onError?: (message: string) => void;
}

export interface ProjectPageComponentProps {
  active: boolean;
  displayPath?: string;
  node?: ProjectPageNode;
  nodeId: string;
  pageState: PageSessionState;
  runtime: ProjectPageRuntime;
  scrollTop: number;
  onScrollChange: (scrollTop: number) => void;
  onStateChange: (state: PageSessionState) => void;
  translate: Translate;
  viewId?: string;
}

export interface ProjectPageTypeDefinition {
  pageType: string;
  icon: string;
  title?: string;
  titleKey?: TranslationKey;
  description?: string;
  descriptionKey?: TranslationKey;
  availability: 'available' | 'coming-soon' | 'unavailable';
  Page?: ComponentType<ProjectPageComponentProps>;
}

type MarkdownDocumentState =
  | { status: 'loading' }
  | { status: 'locked' }
  | { status: 'ready'; document: MarkdownDocument }
  | { status: 'unavailable'; message?: string };

function initialMarkdownState(
  controller: MarkdownDocumentController,
  nodeId: string,
  locked: boolean,
): MarkdownDocumentState {
  if (locked) {
    return { status: 'locked' };
  }
  const cached = controller.getSnapshot(nodeId);
  return cached
    ? {
        status: 'ready',
        document: {
          nodeId,
          content: cached.content,
          readOnly: cached.readOnly,
          revision: cached.revision,
        },
      }
    : { status: 'loading' };
}

function MarkdownProjectPage({
  active,
  displayPath,
  node,
  nodeId,
  onScrollChange,
  onStateChange,
  pageState,
  runtime,
  scrollTop,
  translate,
  viewId,
}: ProjectPageComponentProps) {
  const { preferences } = useFlyoffPreferences();
  const {
    controller,
    lockedNodeIds,
    onPasswordRequired,
    readDocument,
    unlockDocument,
  } = runtime.markdown;
  const locked = lockedNodeIds.has(nodeId);
  const [state, setState] = useState<MarkdownDocumentState>(() =>
    initialMarkdownState(controller, nodeId, locked),
  );

  useEffect(() => {
    let mounted = true;
    if (!locked && !controller.getSnapshot(nodeId)) {
      void readDocument(nodeId)
        .then((result) => {
          if (!mounted) {
            return;
          }

          if (!result.ok) {
            if (result.error.code === 'password-required') {
              onPasswordRequired(nodeId);
              setState({ status: 'locked' });
              return;
            }
            setState({
              status: 'unavailable',
              message: result.error.message,
            });
            return;
          }

          controller.open(result.value);
          setState({ status: 'ready', document: result.value });
        })
        .catch((error: unknown) => {
          if (mounted) {
            setState({ status: 'unavailable', message: String(error) });
          }
        });
    }

    return () => {
      mounted = false;
      controller.discardClean(nodeId);
    };
  }, [controller, locked, nodeId, onPasswordRequired, readDocument]);

  const title =
    displayPath ??
    (node
      ? projectNodeDisplayName(node)
      : translate('projects.unavailable'));

  if (state.status === 'loading') {
    return (
      <main className="project-content-unavailable" role="status">
        <p>{translate('projects.loading')}</p>
      </main>
    );
  }

  if (state.status === 'locked') {
    return (
      <MarkdownLockedView
        onUnlock={(password) => unlockDocument(nodeId, password)}
        title={title}
        translate={translate}
      />
    );
  }

  if (
    state.status === 'unavailable' ||
    (!node && !controller.isDirty(nodeId))
  ) {
    return (
      <main className="project-content-unavailable" role="alert">
        <h1>{title}</h1>
        <p>{translate('projects.unavailable')}</p>
        {state.status === 'unavailable' && state.message ? (
          <small>{state.message}</small>
        ) : null}
      </main>
    );
  }

  const editorMode = readEditorMode(pageState);

  return (
    <MarkdownEditor
      autoFocus={preferences.general.focusEditorOnOpen && active}
      controller={controller}
      document={state.document}
      mode={editorMode}
      onModeChange={(mode) =>
        onStateChange(updateEditorModeState(pageState, mode))
      }
      onError={runtime.onError}
      linkRuntime={runtime.markdown.links}
      navigation={
        runtime.markdown.navigation?.nodeId === nodeId
          ? runtime.markdown.navigation
          : undefined
      }
      onScrollChange={onScrollChange}
      scrollTop={scrollTop}
      title={title}
      translate={translate}
      viewId={viewId}
    />
  );
}

export const PROJECT_PAGE_TYPE_DEFINITIONS = {
  markdown: {
    pageType: 'markdown',
    icon: markdownPageIcon,
    titleKey: 'projects.instanceNote',
    descriptionKey: 'projects.instanceNoteDescription',
    availability: 'available',
    Page: MarkdownProjectPage,
  },
  checklist: {
    pageType: 'checklist',
    icon: checklistIcon,
    titleKey: 'projects.instanceChecklist',
    descriptionKey: 'projects.comingSoon',
    availability: 'coming-soon',
  },
  kanban: {
    pageType: 'kanban',
    icon: kanbanIcon,
    titleKey: 'projects.instanceBoard',
    descriptionKey: 'projects.comingSoon',
    availability: 'coming-soon',
  },
  gallery: {
    pageType: 'gallery',
    icon: galleryIcon,
    titleKey: 'projects.instanceGallery',
    descriptionKey: 'projects.comingSoon',
    availability: 'coming-soon',
  },
} as const satisfies Record<string, ProjectPageTypeDefinition>;

export type RegisteredProjectPageType =
  keyof typeof PROJECT_PAGE_TYPE_DEFINITIONS;

const projectPageTypeRegistry = new Map<string, ProjectPageTypeDefinition>(
  Object.values(PROJECT_PAGE_TYPE_DEFINITIONS).map((definition) => [
    definition.pageType,
    definition,
  ]),
);

export function registerProjectPageTypeDefinition(
  definition: ProjectPageTypeDefinition,
): () => void {
  if (!isProjectInstanceTypeId(definition.pageType)) {
    throw new Error(`Invalid project page type: ${definition.pageType}`);
  }
  if ((!definition.title && !definition.titleKey) ||
      (!definition.description && !definition.descriptionKey)) {
    throw new Error(
      `Project page type requires display metadata: ${definition.pageType}`,
    );
  }
  if (projectPageTypeRegistry.has(definition.pageType)) {
    throw new Error(`Project page type already registered: ${definition.pageType}`);
  }
  projectPageTypeRegistry.set(definition.pageType, definition);
  return () => {
    if (projectPageTypeRegistry.get(definition.pageType) === definition) {
      projectPageTypeRegistry.delete(definition.pageType);
    }
  };
}

export function listProjectPageTypeDefinitions(): readonly ProjectPageTypeDefinition[] {
  return [...projectPageTypeRegistry.values()];
}

export function getProjectPageTypeDefinition(
  pageType: string,
): ProjectPageTypeDefinition | undefined {
  return projectPageTypeRegistry.get(pageType);
}
