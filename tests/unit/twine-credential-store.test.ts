import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TwineCredentialStore,
  type TwineCredentialCrypto,
} from '../../src/main/twine';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-twine-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createCrypto(available = true): TwineCredentialCrypto {
  return {
    decryptString: (encrypted) => Buffer.from(encrypted).toString('utf8'),
    encryptString: (value) => Buffer.from(value, 'utf8'),
    isEncryptionAvailable: () => available,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('TwineCredentialStore', () => {
  it('saves, restores after restart, and removes an encrypted API key', () => {
    const directory = createTemporaryDirectory();
    const store = new TwineCredentialStore(directory, createCrypto());

    expect(store.getStatus()).toEqual({
      encryptionAvailable: true,
      hasApiKey: false,
    });
    expect(store.saveApiKey('  abc123  ')).toEqual({
      encryptionAvailable: true,
      hasApiKey: true,
    });
    expect(store.getApiKey()).toBe('abc123');

    const restoredStore = new TwineCredentialStore(directory, createCrypto());
    expect(restoredStore.getStatus()).toEqual({
      encryptionAvailable: true,
      hasApiKey: true,
    });
    expect(restoredStore.getApiKey()).toBe('abc123');
    expect(restoredStore.removeApiKey()).toEqual({
      encryptionAvailable: true,
      hasApiKey: false,
    });
  });

  it('rejects saving when encryption is unavailable', () => {
    const store = new TwineCredentialStore(
      createTemporaryDirectory(),
      createCrypto(false),
    );

    expect(() => store.saveApiKey('abc123')).toThrow(
      'Credential encryption is unavailable on this device.',
    );
  });

  it('treats invalid persisted credentials as missing', () => {
    const directory = createTemporaryDirectory();
    writeFileSync(
      path.join(directory, 'twine-credentials.json'),
      '{"version":1,"encryptedApiKey":42}',
      'utf8',
    );

    const store = new TwineCredentialStore(directory, createCrypto());
    expect(store.getApiKey()).toBeNull();
    expect(store.getStatus().hasApiKey).toBe(false);
  });
});
