import type {
  ListProjectChildrenRequest,
  ProjectFailureDetails,
  ProjectResult,
  ProjectTreeNode,
} from '../../shared/contracts';

export type ProjectChildrenLoader = (
  request: ListProjectChildrenRequest,
) => Promise<ProjectResult<readonly ProjectTreeNode[]>>;

export interface ProjectTreeBranch {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  nodes: readonly ProjectTreeNode[];
  error?: ProjectFailureDetails;
}

const ROOT_BRANCH = '__flyoff_project_root__';

export const PROJECT_TREE_EXPAND_LIMIT = 500;
export const PROJECT_TREE_EXPAND_CONCURRENCY = 4;

export interface ProjectTreeExpandResult {
  expandedCount: number;
  processedCount: number;
  truncated: boolean;
}

function branchKey(parentId: string | null): string {
  return parentId ?? ROOT_BRANCH;
}

export class ProjectTreeController {
  private readonly branches = new Map<string, ProjectTreeBranch>();
  private readonly expanded = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly loadChildren: ProjectChildrenLoader,
    private readonly onError?: (message: string) => void,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getBranch(parentId: string | null): ProjectTreeBranch {
    return (
      this.branches.get(branchKey(parentId)) ?? {
        status: 'idle',
        nodes: [],
      }
    );
  }

  isExpanded(nodeId: string): boolean {
    return this.expanded.has(nodeId);
  }

  async setExpanded(nodeId: string, expanded: boolean): Promise<boolean> {
    if (expanded) {
      this.expanded.add(nodeId);
      this.emit();
      return this.load(nodeId);
    }

    this.expanded.delete(nodeId);
    this.emit();
    return true;
  }

  async toggle(nodeId: string): Promise<boolean> {
    return this.setExpanded(nodeId, !this.expanded.has(nodeId));
  }

  canExpandBranch(parentId: string | null): boolean {
    if (parentId !== null && !this.expanded.has(parentId)) {
      return true;
    }
    if (this.getBranch(parentId).status !== 'loaded') {
      return true;
    }

    return this.branchFolderIds(parentId).some(
      (nodeId) =>
        !this.expanded.has(nodeId) ||
        this.getBranch(nodeId).status !== 'loaded',
    );
  }

  canCollapseBranch(parentId: string | null): boolean {
    return this.branchFolderIds(parentId, parentId !== null).some((nodeId) =>
      this.expanded.has(nodeId),
    );
  }

  async expandBranch(
    parentId: string | null,
    limit = PROJECT_TREE_EXPAND_LIMIT,
  ): Promise<ProjectTreeExpandResult> {
    const queue: string[] = [];
    const queued = new Set<string>();
    const processed = new Set<string>();
    let expandedCount = 0;

    const enqueue = (nodeId: string): void => {
      if (!queued.has(nodeId) && !processed.has(nodeId)) {
        queued.add(nodeId);
        queue.push(nodeId);
      }
    };

    if (parentId === null) {
      await this.load(null);
      for (const node of this.getBranch(null).nodes) {
        if (node.kind === 'folder') {
          enqueue(node.nodeId);
        }
      }
    } else {
      enqueue(parentId);
    }

    while (queue.length > 0 && processed.size < limit) {
      const available = Math.min(
        PROJECT_TREE_EXPAND_CONCURRENCY,
        limit - processed.size,
      );
      const batch = queue.splice(0, available);
      let changed = false;

      for (const nodeId of batch) {
        queued.delete(nodeId);
        processed.add(nodeId);
        if (!this.expanded.has(nodeId)) {
          this.expanded.add(nodeId);
          expandedCount += 1;
          changed = true;
        }
      }
      if (changed) {
        this.emit();
      }

      await Promise.all(batch.map((nodeId) => this.load(nodeId)));
      for (const nodeId of batch) {
        for (const node of this.getBranch(nodeId).nodes) {
          if (node.kind === 'folder') {
            enqueue(node.nodeId);
          }
        }
      }
    }

    return {
      expandedCount,
      processedCount: processed.size,
      truncated: queue.length > 0,
    };
  }

  collapseBranch(parentId: string | null): number {
    let collapsedCount = 0;
    for (const nodeId of this.branchFolderIds(parentId, parentId !== null)) {
      if (this.expanded.delete(nodeId)) {
        collapsedCount += 1;
      }
    }
    if (collapsedCount > 0) {
      this.emit();
    }
    return collapsedCount;
  }

  async load(parentId: string | null, force = false): Promise<boolean> {
    const key = branchKey(parentId);
    const current = this.branches.get(key);
    if (!force && current?.status === 'loaded') {
      return true;
    }

    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    this.branches.set(key, {
      status: 'loading',
      nodes: current?.nodes ?? [],
    });
    this.emit();

    const operation = this.runLoad(parentId, key);
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === operation) {
        this.pending.delete(key);
      }
    }
  }

  async refreshLoaded(): Promise<boolean> {
    const loadedParentIds = [...this.branches.entries()]
      .filter(([, branch]) => branch.status !== 'idle')
      .map(([key]) => (key === ROOT_BRANCH ? null : key));
    if (loadedParentIds.length === 0) {
      loadedParentIds.push(null);
    }

    const results = await Promise.all(
      loadedParentIds.map((parentId) => this.load(parentId, true)),
    );
    return results.every(Boolean);
  }

  async refreshParents(
    parentIds: readonly (string | null)[],
  ): Promise<boolean> {
    const unique = [...new Set(parentIds.map(branchKey))];
    const results = await Promise.all(
      unique.map((key) => this.load(key === ROOT_BRANCH ? null : key, true)),
    );
    return results.every(Boolean);
  }

  async loadAll(limit = PROJECT_TREE_EXPAND_LIMIT): Promise<boolean> {
    const queue: (string | null)[] = [null];
    const visited = new Set<string>();
    let processed = 0;

    while (queue.length > 0 && processed < limit) {
      const parentId = queue.shift() ?? null;
      const key = branchKey(parentId);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      processed += 1;

      if (!(await this.load(parentId))) {
        return false;
      }
      for (const node of this.getBranch(parentId).nodes) {
        if (node.kind === 'folder') {
          queue.push(node.nodeId);
        }
      }
    }

    return queue.length === 0;
  }

  findNode(nodeId: string): ProjectTreeNode | undefined {
    for (const branch of this.branches.values()) {
      const match = branch.nodes.find((node) => node.nodeId === nodeId);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  dispose(): void {
    this.listeners.clear();
    this.branches.clear();
    this.expanded.clear();
  }

  private async runLoad(parentId: string | null, key: string): Promise<boolean> {
    let result: ProjectResult<readonly ProjectTreeNode[]>;
    try {
      result = await this.loadChildren({ parentId });
    } catch (error) {
      result = {
        ok: false,
        error: { code: 'io-error', message: String(error) },
      };
    }

    if (result.ok) {
      this.branches.set(key, {
        status: 'loaded',
        nodes: result.value,
      });
    } else {
      this.onError?.(result.error.message);
      this.branches.set(key, {
        status: 'error',
        nodes: this.branches.get(key)?.nodes ?? [],
        error: result.error,
      });
    }
    this.emit();
    return result.ok;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private branchFolderIds(
    parentId: string | null,
    includeParent = false,
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (branchParentId: string | null): void => {
      for (const node of this.getBranch(branchParentId).nodes) {
        if (node.kind !== 'folder' || visited.has(node.nodeId)) {
          continue;
        }
        visited.add(node.nodeId);
        result.push(node.nodeId);
        visit(node.nodeId);
      }
    };

    if (includeParent && parentId !== null) {
      visited.add(parentId);
      result.push(parentId);
    }
    visit(parentId);
    return result;
  }
}
