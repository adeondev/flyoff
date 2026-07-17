import { useCallback, useMemo, useRef, useState } from 'react';

import type {
  FlyoffApi,
  MarkdownDocument,
  ProjectPageNode,
  ProjectPageProperties,
  ProjectResult,
  ProjectTreeNode,
} from '../../shared/contracts';
import type { Translate } from '../pages/page-types';
import type { MarkdownDocumentController } from './markdown-document-controller';
import { projectNodeDisplayName } from './project-node-name';
import { projectNodeLogicalPath } from './project-node-path';

type PageSecurityState = 'locked' | 'unlocked';

interface PagePropertiesState {
  loading: boolean;
  properties?: ProjectPageProperties;
  error?: string;
}

interface UseProjectPagePropertiesOptions {
  controller: MarkdownDocumentController;
  nodes: ReadonlyMap<string, ProjectTreeNode>;
  translate: Translate;
}

function getApi(): Partial<FlyoffApi> {
  return window.flyoff as Partial<FlyoffApi>;
}

function unavailable<T>(message: string): ProjectResult<T> {
  return {
    ok: false,
    error: { code: 'invalid-operation', message },
  };
}

export function useProjectPageProperties({
  controller,
  nodes,
  translate,
}: UseProjectPagePropertiesOptions) {
  const [security, setSecurity] = useState<
    ReadonlyMap<string, PageSecurityState>
  >(() => new Map());
  const [targetNodeId, setTargetNodeId] = useState<string>();
  const [state, setState] = useState<PagePropertiesState>({ loading: false });
  const securityRef = useRef<ReadonlyMap<string, PageSecurityState>>(new Map());
  const requestRef = useRef(0);

  const setPageSecurity = useCallback(
    (nodeId: string, nextState?: PageSecurityState): void => {
      const current = securityRef.current.get(nodeId);
      if (current === nextState || (!current && !nextState)) {
        return;
      }
      const next = new Map(securityRef.current);
      if (nextState) {
        next.set(nodeId, nextState);
      } else {
        next.delete(nodeId);
      }
      securityRef.current = next;
      setSecurity(next);
    },
    [],
  );

  const markPasswordRequired = useCallback(
    (nodeId: string): void => setPageSecurity(nodeId, 'locked'),
    [setPageSecurity],
  );

  const acceptProperties = useCallback(
    (properties: ProjectPageProperties): void => {
      const snapshot = controller.getSnapshot(properties.nodeId);
      if (snapshot) {
        if (snapshot.dirty || snapshot.status === 'saving') {
          controller.applyReadOnlyPolicy(
            properties.nodeId,
            properties.readOnly,
          );
        } else {
          controller.adoptProperties(properties.nodeId, properties);
        }
      }
      if (
        properties.passwordProtected &&
        properties.locked &&
        (!snapshot || (!snapshot.dirty && snapshot.status !== 'saving'))
      ) {
        controller.discardSensitive(properties.nodeId);
      }
      setState({ loading: false, properties });
      setPageSecurity(
        properties.nodeId,
        properties.passwordProtected
          ? properties.locked
            ? 'locked'
            : 'unlocked'
          : undefined,
      );
    },
    [controller, setPageSecurity],
  );

  const load = useCallback(
    async (nodeId: string): Promise<void> => {
      const requestId = ++requestRef.current;
      setState({ loading: true });
      const operation = getApi().getProjectPageProperties;
      if (!operation) {
        if (requestRef.current === requestId) {
          setState({
            loading: false,
            error: translate('projects.operationFailed'),
          });
        }
        return;
      }

      try {
        const result = await operation({ nodeId });
        if (requestRef.current !== requestId) {
          return;
        }
        if (result.ok) {
          acceptProperties(result.value);
        } else {
          setState({ loading: false, error: result.error.message });
        }
      } catch (error) {
        if (requestRef.current === requestId) {
          setState({ loading: false, error: String(error) });
        }
      }
    },
    [acceptProperties, translate],
  );

  const open = useCallback(
    (node: ProjectPageNode): void => {
      if (node.pageType !== 'markdown') {
        return;
      }
      setTargetNodeId(node.nodeId);
      void load(node.nodeId);
    },
    [load],
  );

  const close = useCallback((): void => {
    requestRef.current += 1;
    setTargetNodeId(undefined);
    setState({ loading: false });
  }, []);

  const reset = useCallback((): void => {
    requestRef.current += 1;
    securityRef.current = new Map();
    setSecurity(new Map());
    setTargetNodeId(undefined);
    setState({ loading: false });
  }, []);

  const prepareMutation = useCallback(
    async (
      nodeId: string,
      expectedRevision: string,
    ): Promise<ProjectResult<string>> => {
      const snapshot = controller.getSnapshot(nodeId);
      if (!snapshot) {
        return { ok: true, value: expectedRevision };
      }
      try {
        if (!(await controller.flush(nodeId))) {
          return unavailable<string>(translate('projects.saveFailed'));
        }
      } catch (error) {
        return unavailable<string>(String(error));
      }
      return {
        ok: true,
        value: controller.getSnapshot(nodeId)?.revision ?? expectedRevision,
      };
    },
    [controller, translate],
  );

  const applyProperties = useCallback(
    (properties: ProjectPageProperties): void => {
      controller.adoptProperties(properties.nodeId, {
        readOnly: properties.readOnly,
        revision: properties.revision,
      });
      acceptProperties(properties);
    },
    [acceptProperties, controller],
  );

  const setReadOnly = useCallback(
    async (
      readOnly: boolean,
      expectedRevision: string,
    ): Promise<ProjectResult<ProjectPageProperties>> => {
      const nodeId = targetNodeId;
      const operation = getApi().setProjectPageReadOnly;
      if (!nodeId || !operation) {
        return unavailable<ProjectPageProperties>(
          translate('projects.operationFailed'),
        );
      }
      const snapshot = controller.getSnapshot(nodeId);
      const prepared =
        !readOnly && snapshot?.readOnly && snapshot.dirty
          ? ({ ok: true, value: expectedRevision } as const)
          : await prepareMutation(nodeId, expectedRevision);
      if (!prepared.ok) {
        return prepared;
      }
      try {
        const result = await operation({
          nodeId,
          expectedRevision: prepared.value,
          readOnly,
        });
        if (result.ok) {
          applyProperties(result.value);
        }
        return result;
      } catch (error) {
        return unavailable<ProjectPageProperties>(String(error));
      }
    },
    [applyProperties, controller, prepareMutation, targetNodeId, translate],
  );

  const protect = useCallback(
    async (
      password: string,
      expectedRevision: string,
    ): Promise<ProjectResult<ProjectPageProperties>> => {
      const nodeId = targetNodeId;
      const operation = getApi().protectProjectPage;
      if (!nodeId || !operation) {
        return unavailable<ProjectPageProperties>(
          translate('projects.operationFailed'),
        );
      }
      const prepared = await prepareMutation(nodeId, expectedRevision);
      if (!prepared.ok) {
        return prepared;
      }
      try {
        const result = await operation({
          nodeId,
          expectedRevision: prepared.value,
          password,
        });
        if (result.ok) {
          applyProperties(result.value);
        }
        return result;
      } catch (error) {
        return unavailable<ProjectPageProperties>(String(error));
      }
    },
    [applyProperties, prepareMutation, targetNodeId, translate],
  );

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      expectedRevision: string,
    ): Promise<ProjectResult<ProjectPageProperties>> => {
      const nodeId = targetNodeId;
      const operation = getApi().changeProjectPagePassword;
      if (!nodeId || !operation) {
        return unavailable<ProjectPageProperties>(
          translate('projects.operationFailed'),
        );
      }
      const prepared = await prepareMutation(nodeId, expectedRevision);
      if (!prepared.ok) {
        return prepared;
      }
      try {
        const result = await operation({
          nodeId,
          currentPassword,
          expectedRevision: prepared.value,
          newPassword,
        });
        if (result.ok) {
          applyProperties(result.value);
        }
        return result;
      } catch (error) {
        return unavailable<ProjectPageProperties>(String(error));
      }
    },
    [applyProperties, prepareMutation, targetNodeId, translate],
  );

  const removePassword = useCallback(
    async (
      password: string,
      expectedRevision: string,
    ): Promise<ProjectResult<ProjectPageProperties>> => {
      const nodeId = targetNodeId;
      const operation = getApi().removeProjectPagePassword;
      if (!nodeId || !operation) {
        return unavailable<ProjectPageProperties>(
          translate('projects.operationFailed'),
        );
      }
      const prepared = await prepareMutation(nodeId, expectedRevision);
      if (!prepared.ok) {
        return prepared;
      }
      try {
        const result = await operation({
          nodeId,
          expectedRevision: prepared.value,
          password,
        });
        if (result.ok) {
          applyProperties(result.value);
        }
        return result;
      } catch (error) {
        return unavailable<ProjectPageProperties>(String(error));
      }
    },
    [applyProperties, prepareMutation, targetNodeId, translate],
  );

  const unlockDocument = useCallback(
    async (
      nodeId: string,
      password: string,
    ): Promise<ProjectResult<MarkdownDocument>> => {
      const operation = getApi().unlockProjectPage;
      if (!operation) {
        return unavailable<MarkdownDocument>(
          translate('projects.operationFailed'),
        );
      }
      try {
        const result = await operation({ nodeId, password });
        if (result.ok) {
          controller.open(result.value);
          setPageSecurity(nodeId, 'unlocked');
        }
        return result;
      } catch (error) {
        return unavailable<MarkdownDocument>(String(error));
      }
    },
    [controller, setPageSecurity, translate],
  );

  const unlock = useCallback(
    (password: string): Promise<ProjectResult<MarkdownDocument>> =>
      targetNodeId
        ? unlockDocument(targetNodeId, password)
        : Promise.resolve(
            unavailable<MarkdownDocument>(
              translate('projects.operationFailed'),
            ),
          ),
    [targetNodeId, translate, unlockDocument],
  );

  const lockNode = useCallback(
    async (
      nodeId: string,
      nextSecurityState: PageSecurityState | undefined = 'locked',
    ): Promise<ProjectResult<null>> => {
      const operation = getApi().lockProjectPage;
      if (!operation) {
        return unavailable<null>(translate('projects.operationFailed'));
      }
      const hasBuffer = Boolean(controller.getSnapshot(nodeId));
      if (hasBuffer) {
        controller.setMutationLocked(nodeId, true);
      }
      let locked = false;
      try {
        if (hasBuffer && !(await controller.flush(nodeId))) {
          return unavailable<null>(translate('projects.saveFailed'));
        }
        const result = await operation({ nodeId });
        if (!result.ok) {
          return result;
        }
        locked = true;
        controller.discardSensitive(nodeId);
        setPageSecurity(nodeId, nextSecurityState);
        return result;
      } catch (error) {
        return unavailable<null>(String(error));
      } finally {
        if (!locked) {
          controller.setMutationLocked(nodeId, false);
        }
      }
    },
    [controller, setPageSecurity, translate],
  );

  const lock = useCallback(
    (): Promise<ProjectResult<null>> =>
      targetNodeId
        ? lockNode(targetNodeId)
        : Promise.resolve(
            unavailable<null>(translate('projects.operationFailed')),
          ),
    [lockNode, targetNodeId, translate],
  );

  const closeProtectedPage = useCallback(
    async (nodeId: string): Promise<ProjectResult<null>> => {
      const result = await lockNode(nodeId, undefined);
      if (result.ok) {
        setState((current) =>
          current.properties?.nodeId === nodeId &&
          current.properties.passwordProtected
            ? {
                loading: false,
                properties: { ...current.properties, locked: true },
              }
            : current,
        );
      }
      return result;
    },
    [lockNode],
  );

  const discardRemoved = useCallback(
    (nodeIds: readonly string[]): void => {
      for (const nodeId of nodeIds) {
        controller.discardSensitive(nodeId);
        setPageSecurity(nodeId, undefined);
      }
      if (targetNodeId && nodeIds.includes(targetNodeId)) {
        close();
      }
    },
    [close, controller, setPageSecurity, targetNodeId],
  );

  const nodeCandidate = targetNodeId ? nodes.get(targetNodeId) : undefined;
  const node =
    nodeCandidate?.kind === 'page' && nodeCandidate.pageType === 'markdown'
      ? (nodeCandidate as ProjectPageNode & { pageType: 'markdown' })
      : undefined;
  const logicalPath = node
    ? projectNodeLogicalPath(nodes, node.nodeId) ??
      `/${projectNodeDisplayName(node)}`
    : undefined;
  const lockedNodeIds = useMemo(
    () =>
      new Set(
        [...security].flatMap(([nodeId, pageState]) =>
          pageState === 'locked' ? [nodeId] : [],
        ),
      ),
    [security],
  );

  return {
    acceptProperties,
    changePassword,
    close,
    closeProtectedPage,
    discardRemoved,
    load,
    lock,
    lockedNodeIds,
    logicalPath,
    markPasswordRequired,
    node,
    open,
    protect,
    removePassword,
    reset,
    setReadOnly,
    state,
    unlock,
    unlockDocument,
  };
}
