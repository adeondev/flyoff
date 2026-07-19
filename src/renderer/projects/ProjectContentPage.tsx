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
  active: boolean;
  displayPath?: string;
  node?: ProjectTreeNode;
  nodeId: string;
  pageState: PageSessionState;
  pageType: string;
  runtime: ProjectPageRuntime;
  scrollTop: number;
  onScrollChange: (scrollTop: number) => void;
  onStateChange: (state: PageSessionState) => void;
  translate: Translate;
  viewId?: string;
}

export function ProjectContentPage({
  active,
  displayPath,
  node,
  nodeId,
  pageState,
  pageType,
  runtime,
  scrollTop,
  onScrollChange,
  onStateChange,
  translate,
  viewId,
}: ProjectContentPageProps) {
  const definition = getProjectPageTypeDefinition(pageType);

  if (
    !definition ||
    !definition.Page ||
    definition.availability !== 'available' ||
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
      active={active}
      displayPath={displayPath}
      key={`${nodeId}:${
        pageType === 'markdown' && runtime.markdown.lockedNodeIds.has(nodeId)
          ? 'locked'
          : 'open'
      }`}
      node={node?.kind === 'page' ? node : undefined}
      nodeId={nodeId}
      pageState={pageState}
      runtime={runtime}
      scrollTop={scrollTop}
      onScrollChange={onScrollChange}
      onStateChange={onStateChange}
      translate={translate}
      viewId={viewId}
    />
  );
}
