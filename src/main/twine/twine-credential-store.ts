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

import type { TwineCredentialStatus } from '../../shared/contracts';

const TWINE_CREDENTIALS_FILENAME = 'twine-credentials.json';
const TWINE_CREDENTIALS_VERSION = 1;
const TWINE_CREDENTIALS_MAX_BYTES = 16 * 1_024;

export interface TwineCredentialCrypto {
  decryptString(encrypted: Buffer): string;
  encryptString(value: string): Buffer;
  isEncryptionAvailable(): boolean;
}

interface StoredTwineCredentials {
  encryptedApiKey: string;
  version: typeof TWINE_CREDENTIALS_VERSION;
}

function isStoredTwineCredentials(
  value: unknown,
): value is StoredTwineCredentials {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as StoredTwineCredentials).version === TWINE_CREDENTIALS_VERSION &&
    typeof (value as StoredTwineCredentials).encryptedApiKey === 'string'
  );
}

export class TwineCredentialStore {
  readonly filePath: string;

  constructor(
    userDataPath: string,
    private readonly crypto: TwineCredentialCrypto,
  ) {
    this.filePath = path.join(userDataPath, TWINE_CREDENTIALS_FILENAME);
  }

  getStatus(): TwineCredentialStatus {
    return {
      encryptionAvailable: this.crypto.isEncryptionAvailable(),
      hasApiKey: this.getApiKey() !== null,
    };
  }

  getApiKey(): string | null {
    try {
      if (statSync(this.filePath).size > TWINE_CREDENTIALS_MAX_BYTES) {
        return null;
      }
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!isStoredTwineCredentials(value)) {
        return null;
      }
      const apiKey = this.crypto.decryptString(
        Buffer.from(value.encryptedApiKey, 'base64'),
      );
      return apiKey.trim().length > 0 ? apiKey : null;
    } catch {
      return null;
    }
  }

  removeApiKey(): TwineCredentialStatus {
    rmSync(this.filePath, { force: true });
    return this.getStatus();
  }

  saveApiKey(apiKey: string): TwineCredentialStatus {
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new TypeError('Invalid Twine API key.');
    }
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error('Credential encryption is unavailable on this device.');
    }

    const credentials: StoredTwineCredentials = {
      encryptedApiKey: this.crypto.encryptString(normalized).toString('base64'),
      version: TWINE_CREDENTIALS_VERSION,
    };
    this.write(credentials);
    return this.getStatus();
  }

  private write(credentials: StoredTwineCredentials): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });

    const serialized = `${JSON.stringify(credentials, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > TWINE_CREDENTIALS_MAX_BYTES) {
      throw new RangeError('The Twine credentials file is too large.');
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
