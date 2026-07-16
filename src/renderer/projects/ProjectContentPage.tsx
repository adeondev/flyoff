import type {
  PageSessionState,
  ProjectTreeNode,
} from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import {
  getProjectPageTypeDefinition,
  type ProjectPageRuntime,
} from './project-page-type-registry';

export interface ProjectContentPageProps {
  node?: ProjectTreeNode;
  nodeId: string;
  pageState: PageSessionState;
  pageType: string;
  runtime: ProjectPageRuntime;
  scrollTop: number;
  onScrollChange: (scrollTop: number) => void;
  onStateChange: (state: PageSessionState) => void;
  translate: Translate;
}

export function ProjectContentPage({
  node,
  nodeId,
  pageState,
  pageType,
  runtime,
  scrollTop,
  onScrollChange,
  onStateChange,
  translate,
}: ProjectContentPageProps) {
  const definition = getProjectPageTypeDefinition(pageType);

  if (
    !definition ||
    (node !== undefined &&
      (node.kind !== 'page' || node.pageType !== pageType))
  ) {
    return (
      <main className="project-content-unavailable" role="alert">
        <p>{translate('projects.unavailable')}</p>
      </main>
    );
  }

  const Page = definition.Page;
  return (
    <Page
      node={node?.kind === 'page' ? node : undefined}
      nodeId={nodeId}
      pageState={pageState}
      runtime={runtime}
      scrollTop={scrollTop}
      onScrollChange={onScrollChange}
      onStateChange={onStateChange}
      translate={translate}
    />
  );
}
