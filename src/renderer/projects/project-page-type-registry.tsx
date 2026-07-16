import { useEffect, useState, type ComponentType } from 'react';

import markdownPageIcon from '../../../public/images/icons/homepage/import-project.svg';
import type {
  MarkdownDocument,
  PageSessionState,
  ProjectPageNode,
  ProjectResult,
} from '../../shared/contracts';
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
  Page: ComponentType<ProjectPageComponentProps>;
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
    Page: MarkdownProjectPage,
  },
} as const satisfies Record<string, ProjectPageTypeDefinition>;

export type RegisteredProjectPageType =
  keyof typeof PROJECT_PAGE_TYPE_DEFINITIONS;

export function getProjectPageTypeDefinition(
  pageType: string,
): ProjectPageTypeDefinition | undefined {
  return (
    PROJECT_PAGE_TYPE_DEFINITIONS as Record<
      string,
      ProjectPageTypeDefinition
    >
  )[pageType];
}
