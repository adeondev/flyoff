import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  hasRestorablePages,
  normalizeTabSessionSnapshot,
  TAB_SESSION_MAX_BYTES,
  type TabSessionSnapshot,
} from '../../shared/contracts';

const TAB_SESSION_FILENAME = 'tab-session.json';

export class TabSessionStore {
  readonly filePath: string;

  private currentSession: TabSessionSnapshot | undefined;
  private pendingRestore: TabSessionSnapshot | undefined;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, TAB_SESSION_FILENAME);

    const persisted = this.load();
    this.currentSession = persisted;

    if (persisted && hasRestorablePages(persisted)) {
      this.pendingRestore = persisted;
    }
  }

  getRestorableSession(): TabSessionSnapshot | null {
    return this.pendingRestore ?? null;
  }

  beginWindowSession(): void {
    if (
      !this.pendingRestore &&
      this.currentSession &&
      hasRestorablePages(this.currentSession)
    ) {
      this.pendingRestore = this.currentSession;
    }
  }

  resolveRestorableSession(session: TabSessionSnapshot): void {
    if (!this.pendingRestore) {
      throw new Error('There is no restorable tab session to resolve.');
    }

    this.write(session);
    this.pendingRestore = undefined;
    this.currentSession = session;
  }

  save(session: TabSessionSnapshot): void {
    if (this.pendingRestore) {
      throw new Error(
        'The previous tab session must be resolved before saving a new one.',
      );
    }

    this.currentSession = session;
    this.write(session);
  }

  saveFinal(session: TabSessionSnapshot): void {
    this.write(session);
    this.pendingRestore = undefined;
    this.currentSession = session;
  }

  flush(): void {
    if (this.pendingRestore || !this.currentSession) {
      return;
    }

    this.write(this.currentSession);
  }

  private load(): TabSessionSnapshot | undefined {
    try {
      if (statSync(this.filePath).size > TAB_SESSION_MAX_BYTES) {
        return undefined;
      }

      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return normalizeTabSessionSnapshot(value);
    } catch {
      return undefined;
    }
  }

  private write(session: TabSessionSnapshot): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });

    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const serialized = `${JSON.stringify(session, null, 2)}\n`;

    if (Buffer.byteLength(serialized, 'utf8') > TAB_SESSION_MAX_BYTES) {
      throw new RangeError('The tab session exceeds the persistence limit.');
    }

    writeFileSync(temporaryPath, serialized, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }
}
