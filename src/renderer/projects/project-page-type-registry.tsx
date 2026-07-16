import { useEffect, useState, type ComponentType } from 'react';

import checklistIcon from '../../../public/images/icons/instances/checklist.svg';
import galleryIcon from '../../../public/images/icons/instances/image.svg';
import markdownPageIcon from '../../../public/images/icons/instances/note.svg';
import kanbanIcon from '../../../public/images/icons/instances/table.svg';
import type {
  MarkdownDocument,
  PageSessionState,
  ProjectPageNode,
  ProjectResult,
} from '../../shared/contracts';
import { isProjectInstanceTypeId } from '../../shared/contracts';
import type { TranslationKey } from '../../shared/i18n/catalogs';
import type { Translate } from '../pages/page-types';
import { createEditorModeState, readEditorMode } from './editor-mode';
import type { MarkdownDocumentController } from './markdown-document-controller';
import { MarkdownEditor } from './MarkdownEditor';
import { projectNodeDisplayName } from './project-node-name';

export interface MarkdownPageRuntime {
  controller: MarkdownDocumentController;
  readDocument: (
    nodeId: string,
  ) => Promise<ProjectResult<MarkdownDocument>>;
}

export interface ProjectPageRuntime {
  markdown: MarkdownPageRuntime;
  onError?: (message: string) => void;
}

export interface ProjectPageComponentProps {
  node?: ProjectPageNode;
  nodeId: string;
  pageState: PageSessionState;
  runtime: ProjectPageRuntime;
  scrollTop: number;
  onScrollChange: (scrollTop: number) => void;
  onStateChange: (state: PageSessionState) => void;
  translate: Translate;
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
  | { status: 'ready'; document: MarkdownDocument }
  | { status: 'unavailable'; message?: string };

function initialMarkdownState(
  controller: MarkdownDocumentController,
  nodeId: string,
): MarkdownDocumentState {
  const cached = controller.getSnapshot(nodeId);
  return cached
    ? {
        status: 'ready',
        document: {
          nodeId,
          content: cached.content,
          revision: cached.revision,
        },
      }
    : { status: 'loading' };
}

function MarkdownProjectPage({
  node,
  nodeId,
  onScrollChange,
  onStateChange,
  pageState,
  runtime,
  scrollTop,
  translate,
}: ProjectPageComponentProps) {
  const { controller, readDocument } = runtime.markdown;
  const [state, setState] = useState<MarkdownDocumentState>(() =>
    initialMarkdownState(controller, nodeId),
  );

  useEffect(() => {
    let active = true;
    if (!controller.getSnapshot(nodeId)) {
      void readDocument(nodeId)
        .then((result) => {
          if (!active) {
            return;
          }

          if (!result.ok) {
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
          if (active) {
            setState({ status: 'unavailable', message: String(error) });
          }
        });
    }

    return () => {
      active = false;
      controller.discardClean(nodeId);
    };
  }, [controller, nodeId, readDocument]);

  const title = node
    ? projectNodeDisplayName(node)
    : translate('projects.unavailable');

  if (state.status === 'loading') {
    return (
      <main className="project-content-unavailable" role="status">
        <p>{translate('projects.loading')}</p>
      </main>
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

  return (
    <MarkdownEditor
      autoFocus
      controller={controller}
      document={state.document}
      mode={readEditorMode(pageState)}
      onModeChange={(mode) => onStateChange(createEditorModeState(mode))}
      onError={runtime.onError}
      onScrollChange={onScrollChange}
      scrollTop={scrollTop}
      title={title}
      translate={translate}
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
