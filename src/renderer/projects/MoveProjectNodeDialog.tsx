import { useEffect, useId, useReducer, useState, type FormEvent } from 'react';

import chevronRightIcon from '../../../public/images/icons/actions/chevron-right.svg';
import folderOpenIcon from '../../../public/images/icons/instances/folder-open.svg';
import folderIcon from '../../../public/images/icons/instances/folder.svg';
import type {
  MoveProjectNodeRequest,
  ProjectResult,
  ProjectTreeNode,
} from '../../shared/contracts';
import { MaskedIcon } from '../components/MaskedIcon';
import { Dialog } from '../components/dialog';
import type { Translate } from '../pages/page-types';
import { projectNodeDisplayName } from './project-node-name';
import type { ProjectTreeController } from './project-tree-controller';

interface FolderBranchProps {
  controller: ProjectTreeController;
  excludedNodeId: string;
  parentId: string | null;
  selectedId: string | null | undefined;
  translate: Translate;
  onSelect: (nodeId: string) => void;
}

function FolderBranch({
  controller,
  excludedNodeId,
  onSelect,
  parentId,
  selectedId,
  translate,
}: FolderBranchProps) {
  const branch = controller.getBranch(parentId);
  const folders = branch.nodes.filter(
    (node) => node.kind === 'folder' && node.nodeId !== excludedNodeId,
  );

  return (
    <div role={parentId ? 'group' : undefined}>
      {folders.map((folder) => {
        const expanded = controller.isExpanded(folder.nodeId);
        return (
          <div className="project-folder-picker__branch" key={folder.nodeId}>
            <div
              aria-selected={selectedId === folder.nodeId}
              className="project-folder-picker__row"
              role="treeitem"
            >
              <button
                aria-expanded={expanded}
                aria-label={`${expanded ? '−' : '+'} ${projectNodeDisplayName(folder)}`}
                className="project-folder-picker__expand"
                onClick={() => void controller.toggle(folder.nodeId)}
                type="button"
              >
                <MaskedIcon
                  className={`project-folder-picker__chevron${
                    expanded ? ' project-folder-picker__chevron--expanded' : ''
                  }`}
                  icon={chevronRightIcon}
                />
              </button>
              <button
                className="project-folder-picker__select"
                onClick={() => onSelect(folder.nodeId)}
                type="button"
              >
                <MaskedIcon
                  className="project-tree__kind"
                  icon={expanded ? folderOpenIcon : folderIcon}
                />
                {projectNodeDisplayName(folder)}
              </button>
            </div>
            {expanded ? (
              <FolderBranch
                controller={controller}
                excludedNodeId={excludedNodeId}
                onSelect={onSelect}
                parentId={folder.nodeId}
                selectedId={selectedId}
                translate={translate}
              />
            ) : null}
          </div>
        );
      })}
      {branch.status === 'loading' && folders.length === 0 ? (
        <div className="project-folder-picker__message" role="status">
          {translate('projects.loading')}
        </div>
      ) : null}
      {branch.status === 'error' ? (
        <button
          className="project-folder-picker__message"
          onClick={() => void controller.load(parentId, true)}
          type="button"
        >
          {translate('projects.loadFailed')}
        </button>
      ) : null}
    </div>
  );
}

export interface MoveProjectNodeDialogProps {
  controller: ProjectTreeController;
  node: ProjectTreeNode;
  translate: Translate;
  onCancel: () => void;
  onError?: (message: string) => void;
  onMove: (
    request: MoveProjectNodeRequest,
  ) => Promise<ProjectResult<ProjectTreeNode>>;
  onMoved: (node: ProjectTreeNode) => void;
}

export function MoveProjectNodeDialog({
  controller,
  node,
  onCancel,
  onError,
  onMove,
  onMoved,
  translate,
}: MoveProjectNodeDialogProps) {
  const formId = useId();
  const [, renderVersion] = useReducer((version: number) => version + 1, 0);
  const [destination, setDestination] = useState<string | null | undefined>(
    node.parentId,
  );
  const [pending, setPending] = useState(false);

  useEffect(() => controller.subscribe(renderVersion), [controller]);
  useEffect(() => {
    void controller.load(null);
  }, [controller]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (destination === undefined || destination === node.parentId) {
      return;
    }

    setPending(true);
    try {
      const result = await onMove({ nodeId: node.nodeId, parentId: destination });
      if (result.ok) {
        await controller.refreshParents([node.parentId, destination]);
        onMoved(result.value);
      } else {
        onError?.(result.error.message);
      }
    } catch (operationError) {
      onError?.(String(operationError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      busy={pending}
      closeLabel={translate('windowControls.close')}
      description={translate('projects.selectDestination')}
      footerEnd={
        <button
          className="flyoff-dialog__button--primary"
          disabled={
            pending || destination === undefined || destination === node.parentId
          }
          form={formId}
          type="submit"
        >
          {pending ? translate('projects.moving') : translate('projects.move')}
        </button>
      }
      footerStart={
        <button disabled={pending} onClick={onCancel} type="button">
          {translate('projects.cancel')}
        </button>
      }
      onCancel={onCancel}
      title={translate('projects.moveTitle')}
    >
      <form
        className="flyoff-dialog__form"
        id={formId}
        onSubmit={(event) => void submit(event)}
      >
        <div
          aria-label={translate('projects.selectDestination')}
          className="project-folder-picker"
          role="tree"
        >
          <button
            aria-selected={destination === null}
            className="project-folder-picker__root"
            data-dialog-initial-focus
            onClick={() => setDestination(null)}
            role="treeitem"
            type="button"
          >
            <MaskedIcon className="project-tree__kind" icon={folderIcon} />
            {translate('projects.rootFolder')}
          </button>
          <FolderBranch
            controller={controller}
            excludedNodeId={node.nodeId}
            onSelect={setDestination}
            parentId={null}
            selectedId={destination}
            translate={translate}
          />
        </div>
      </form>
    </Dialog>
  );
}
