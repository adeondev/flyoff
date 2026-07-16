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
}
