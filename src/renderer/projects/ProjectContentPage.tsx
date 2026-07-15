import type { ProjectTreeNode } from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import {
  getProjectPageTypeDefinition,
  type ProjectPageRuntime,
} from './project-page-type-registry';

export interface ProjectContentPageProps {
  node?: ProjectTreeNode;
  nodeId: string;
  pageType: string;
  runtime: ProjectPageRuntime;
  scrollTop: number;
  onScrollChange: (scrollTop: number) => void;
  translate: Translate;
}

export function ProjectContentPage({
  node,
  nodeId,
  pageType,
  runtime,
  scrollTop,
  onScrollChange,
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
      runtime={runtime}
      scrollTop={scrollTop}
      onScrollChange={onScrollChange}
      translate={translate}
    />
  );
}
