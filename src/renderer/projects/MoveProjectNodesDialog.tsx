import { useEffect, useId, useReducer, useState, type FormEvent } from 'react';

import folderIcon from '../../../public/images/icons/instances/folder-solid.svg';
import type {
  MoveProjectNodesRequest,
  ProjectNodesMutationOutcome,
  ProjectResult,
  ProjectTreeNode,
} from '../../shared/contracts';
import { MaskedIcon } from '../components/MaskedIcon';
import { Dialog } from '../components/dialog';
import type { Translate } from '../pages/page-types';
import { ProjectFolderPickerBranch } from './MoveProjectNodeDialog';
import type { ProjectTreeController } from './project-tree-controller';

interface MoveProjectNodesDialogProps {
  controller: ProjectTreeController;
  nodes: readonly ProjectTreeNode[];
  onCancel: () => void;
  onError?: (message: string) => void;
  onMove: (
    request: MoveProjectNodesRequest,
  ) => Promise<ProjectResult<ProjectNodesMutationOutcome>>;
  onMoved: (nodes: readonly ProjectTreeNode[]) => void;
  translate: Translate;
}

export function MoveProjectNodesDialog({
  controller,
  nodes,
  onCancel,
  onError,
  onMove,
  onMoved,
  translate,
}: MoveProjectNodesDialogProps) {
  const formId = useId();
  const [, renderVersion] = useReducer((version: number) => version + 1, 0);
  const [destination, setDestination] = useState<string | null>();
  const [pending, setPending] = useState(false);

  useEffect(() => controller.subscribe(renderVersion), [controller]);
  useEffect(() => {
    void controller.load(null);
  }, [controller]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (destination === undefined) {
      return;
    }

    setPending(true);
    try {
      const result = await onMove({
        nodeIds: nodes.map(({ nodeId }) => nodeId),
        parentId: destination,
      });
      if (result.ok) {
        await controller.refreshParents([
          ...nodes.map(({ parentId }) => parentId),
          destination,
        ]);
        onMoved(result.value.nodes);
      } else {
        onError?.(result.error.message);
      }
    } catch (error) {
      onError?.(String(error));
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
          disabled={pending || destination === undefined}
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
      title={translate('projects.moveSelected')}
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
          <ProjectFolderPickerBranch
            controller={controller}
            excludedNodeIds={
              new Set(nodes.map(({ nodeId }) => nodeId))
            }
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
