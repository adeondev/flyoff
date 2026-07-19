import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  createDefaultFlyoffPreferences,
  normalizeFlyoffPreferences,
  PREFERENCES_MAX_BYTES,
  type FlyoffPreferences,
} from '../../shared/contracts';

const PREFERENCES_FILENAME = 'preferences.json';

export class PreferencesStore {
  readonly filePath: string;

  private current: FlyoffPreferences;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, PREFERENCES_FILENAME);
    this.current = this.load();
  }

  get(): FlyoffPreferences {
    return normalizeFlyoffPreferences(this.current);
  }

  save(preferences: FlyoffPreferences): FlyoffPreferences {
    const normalized = normalizeFlyoffPreferences(preferences);
    this.write(normalized);
    this.current = normalized;
    return this.get();
  }

  reset(): FlyoffPreferences {
    return this.save(createDefaultFlyoffPreferences());
  }

  private load(): FlyoffPreferences {
    try {
      if (statSync(this.filePath).size > PREFERENCES_MAX_BYTES) {
        return createDefaultFlyoffPreferences();
      }
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return normalizeFlyoffPreferences(value);
    } catch {
      return createDefaultFlyoffPreferences();
    }
  }

  private write(preferences: FlyoffPreferences): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });

    const serialized = `${JSON.stringify(preferences, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > PREFERENCES_MAX_BYTES) {
      throw new RangeError('The preferences file exceeds the supported limit.');
    }

    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}
