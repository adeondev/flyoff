import type {
  EncryptedNoteKey,
} from './encrypted-note-crypto';
import type { EncryptedNoteInspection } from './encrypted-note-format';

export interface EncryptedNoteKeyScope {
  clientId: number | string;
  nodeId: string;
  projectId: string;
}

interface SessionEntry {
  key: EncryptedNoteKey;
  scope: EncryptedNoteKeyScope;
}

function validateScope(scope: EncryptedNoteKeyScope): void {
  const validClient =
    (typeof scope.clientId === 'number' &&
      Number.isSafeInteger(scope.clientId) &&
      scope.clientId >= 0) ||
    (typeof scope.clientId === 'string' && scope.clientId.length > 0);
  const validProject =
    typeof scope.projectId === 'string' && scope.projectId.length > 0;
  const validNode = typeof scope.nodeId === 'string' && scope.nodeId.length > 0;

  if (!validClient || !validProject || !validNode) {
    throw new TypeError('The encrypted note key scope is invalid.');
  }
}

function scopeIdentifier(scope: EncryptedNoteKeyScope): string {
  return JSON.stringify([
    typeof scope.clientId,
    scope.clientId,
    scope.projectId,
    scope.nodeId,
  ]);
}

export class EncryptedNoteKeySession {
  readonly #entries = new Map<string, SessionEntry>();

  get size(): number {
    return this.#entries.size;
  }

  store(scope: EncryptedNoteKeyScope, key: EncryptedNoteKey): void {
    validateScope(scope);
    if (key.destroyed) {
      throw new TypeError('A destroyed encrypted note key cannot be stored.');
    }

    const id = scopeIdentifier(scope);
    for (const [storedId, entry] of this.#entries) {
      if (storedId !== id && entry.key === key) {
        throw new TypeError(
          'An encrypted note key cannot be shared between session scopes.',
        );
      }
    }

    const previous = this.#entries.get(id);
    if (previous?.key !== key) {
      previous?.key.destroy();
    }
    this.#entries.set(id, { key, scope: { ...scope } });
  }

  peek(scope: EncryptedNoteKeyScope): EncryptedNoteKey | undefined {
    validateScope(scope);
    return this.#entries.get(scopeIdentifier(scope))?.key;
  }

  resolve(
    scope: EncryptedNoteKeyScope,
    inspection: EncryptedNoteInspection,
  ): EncryptedNoteKey | undefined {
    validateScope(scope);
    const id = scopeIdentifier(scope);
    const entry = this.#entries.get(id);
    if (!entry) {
      return undefined;
    }

    if (!entry.key.matches(inspection)) {
      this.#entries.delete(id);
      entry.key.destroy();
      return undefined;
    }

    return entry.key;
  }

  remove(scope: EncryptedNoteKeyScope): boolean {
    validateScope(scope);
    const id = scopeIdentifier(scope);
    const entry = this.#entries.get(id);
    if (!entry) {
      return false;
    }

    this.#entries.delete(id);
    entry.key.destroy();
    return true;
  }

  removeClient(clientId: EncryptedNoteKeyScope['clientId']): number {
    return this.removeWhere((scope) => scope.clientId === clientId);
  }

  removeProject(
    clientId: EncryptedNoteKeyScope['clientId'],
    projectId: string,
  ): number {
    return this.removeWhere(
      (scope) => scope.clientId === clientId && scope.projectId === projectId,
    );
  }

  removeNode(projectId: string, nodeId: string): number {
    return this.removeWhere(
      (scope) => scope.projectId === projectId && scope.nodeId === nodeId,
    );
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      entry.key.destroy();
    }
    this.#entries.clear();
  }

  private removeWhere(
    predicate: (scope: EncryptedNoteKeyScope) => boolean,
  ): number {
    let removed = 0;
    for (const [id, entry] of this.#entries) {
      if (!predicate(entry.scope)) {
        continue;
      }

      this.#entries.delete(id);
      entry.key.destroy();
      removed += 1;
    }
    return removed;
  }
}
