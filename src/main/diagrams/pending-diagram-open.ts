import path from 'node:path';

const pending = new Map<string, string>();

function pendingKey(candidate: string): string {
  const normalized = path.normalize(candidate);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

export function queuePendingDiagramOpen(candidate: string): boolean {
  if (!path.isAbsolute(candidate) || path.extname(candidate).toLowerCase() !== '.flyd') {
    return false;
  }
  const normalized = path.normalize(candidate);
  const key = pendingKey(normalized);
  if (!pending.has(key)) {
    pending.set(key, normalized);
  }
  return true;
}

export function peekPendingDiagramOpen(): string | undefined {
  return pending.values().next().value as string | undefined;
}

export function completePendingDiagramOpen(candidate: string): void {
  pending.delete(pendingKey(candidate));
}

export function pendingDiagramOpenCount(): number {
  return pending.size;
}
