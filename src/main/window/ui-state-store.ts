import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  createDefaultWorkspaceLayoutState,
  normalizeWorkspaceLayoutState,
  type WorkspaceLayoutState,
} from '../../shared/contracts';

const UI_STATE_FILENAME = 'ui-state.json';

export class UiStateStore {
  readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, UI_STATE_FILENAME);
  }

  load(): WorkspaceLayoutState {
    try {
      const state: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return normalizeWorkspaceLayoutState(state);
    } catch {
      return createDefaultWorkspaceLayoutState();
    }
  }

  save(state: WorkspaceLayoutState): void {
    const normalized = normalizeWorkspaceLayoutState(state);

    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        `${JSON.stringify(normalized, null, 2)}\n`,
        'utf8',
      );
    } catch {
      return;
    }
  }
}
