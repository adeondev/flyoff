import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  changeEncryptedNotePassword,
  decryptEncryptedNote,
  type EncryptedNoteCryptoDependencies,
  encryptNote,
  unlockEncryptedNote,
  updateEncryptedNoteContent,
} from '../../src/main/projects/encrypted-note-crypto';
import {
  ENCRYPTED_NOTE_SIGNATURE,
  ENCRYPTED_NOTE_VERSION,
  hasEncryptedNoteSignature,
  inspectEncryptedNote,
} from '../../src/main/projects/encrypted-note-format';
import { EncryptedNoteKeySession } from '../../src/main/projects/encrypted-note-key-session';
import { MARKDOWN_DOCUMENT_MAX_BYTES } from '../../src/shared/contracts';

interface TestEnvelopeHeader {
  content: {
    nonce: string;
    plaintextBytes: number;
    tag: string;
  };
  encryptionId: string;
  key: {
    kdf: {
      N: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function createDependencies(): EncryptedNoteCryptoDependencies {
  let randomValue = 1;
  return {
    deriveKey: async (password, salt) =>
      createHash('sha256').update(password).update(salt).digest(),
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
  };
}

function splitEnvelope(bytes: Buffer): {
  ciphertext: Buffer;
  header: TestEnvelopeHeader;
  headerText: string;
} {
  const signatureBytes = Buffer.byteLength(ENCRYPTED_NOTE_SIGNATURE, 'ascii');
  const headerLength = bytes.readUInt32BE(signatureBytes + 1);
  const headerStart = signatureBytes + 5;
  const headerEnd = headerStart + headerLength;
  const headerText = bytes.subarray(headerStart, headerEnd).toString('utf8');
  return {
    ciphertext: Buffer.from(bytes.subarray(headerEnd)),
    header: JSON.parse(headerText) as TestEnvelopeHeader,
    headerText,
  };
}

function rebuildEnvelope(headerText: string, ciphertext: Buffer): Buffer {
  const signature = Buffer.from(ENCRYPTED_NOTE_SIGNATURE, 'ascii');
  const header = Buffer.from(headerText, 'utf8');
  const prefix = Buffer.alloc(signature.byteLength + 5);
  signature.copy(prefix);
  prefix[signature.byteLength] = ENCRYPTED_NOTE_VERSION;
  prefix.writeUInt32BE(header.byteLength, signature.byteLength + 1);
  return Buffer.concat([prefix, header, ciphertext]);
}

describe('encrypted note envelope', () => {
  it('derives one production scrypt key with the configured cost', async () => {
    let randomValue = 1;
    const content = Buffer.from('verificaÃ§Ã£o scrypt real', 'utf8');
    const encrypted = await encryptNote(
      content,
      Buffer.from('senha real suficientemente longa', 'utf8'),
      { randomBytes: (size) => Buffer.alloc(size, randomValue++) },
    );

    expect(decryptEncryptedNote(encrypted.bytes, encrypted.key)).toEqual(content);
    encrypted.key.destroy();
  });

  it('accepts a one-character password without changing encryption semantics', async () => {
    const dependencies = createDependencies();
    const deriveKey = vi.fn(dependencies.deriveKey);

    const encrypted = await encryptNote(Buffer.from('content'), Buffer.from('x'), {
      ...dependencies,
      deriveKey,
    });

    expect(deriveKey).toHaveBeenCalledTimes(1);
    expect(decryptEncryptedNote(encrypted.bytes, encrypted.key)).toEqual(
      Buffer.from('content'),
    );
    encrypted.key.destroy();
  });

  it('encrypts and unlocks content without exposing plaintext on disk', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const content = Buffer.from('texto confidencial único\n', 'utf8');
    const encrypted = await encryptNote(content, password, dependencies);

    expect(hasEncryptedNoteSignature(encrypted.bytes)).toBe(true);
    expect(encrypted.bytes.includes(content)).toBe(false);
    expect(encrypted.inspection).toEqual(inspectEncryptedNote(encrypted.bytes));
    expect(encrypted.inspection).toMatchObject({
      contentSizeBytes: content.byteLength,
      diskSizeBytes: encrypted.bytes.byteLength,
      pageType: 'markdown',
      version: 1,
    });

    const unlocked = await unlockEncryptedNote(
      encrypted.bytes,
      password,
      dependencies,
    );
    expect(unlocked.content).toEqual(content);
    expect(unlocked.key.matches(encrypted.inspection)).toBe(true);
    expect(decryptEncryptedNote(encrypted.bytes, encrypted.key)).toEqual(content);

    encrypted.key.destroy();
    unlocked.key.destroy();
    expect(encrypted.key.destroyed).toBe(true);
    expect(unlocked.key.destroyed).toBe(true);
  });

  it('supports empty content and rejects content beyond the Markdown limit', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const encrypted = await encryptNote(Buffer.alloc(0), password, dependencies);
    const unlocked = await unlockEncryptedNote(
      encrypted.bytes,
      password,
      dependencies,
    );

    expect(unlocked.content).toEqual(Buffer.alloc(0));
    expect(encrypted.inspection.contentSizeBytes).toBe(0);
    const maximumContent = Buffer.alloc(MARKDOWN_DOCUMENT_MAX_BYTES, 0x61);
    const maximum = await encryptNote(
      maximumContent,
      password,
      dependencies,
    );
    const maximumUnlocked = await unlockEncryptedNote(
      maximum.bytes,
      password,
      dependencies,
    );
    expect(maximum.inspection.contentSizeBytes).toBe(
      MARKDOWN_DOCUMENT_MAX_BYTES,
    );
    expect(maximumUnlocked.content.equals(maximumContent)).toBe(true);
    await expect(
      encryptNote(
        Buffer.alloc(MARKDOWN_DOCUMENT_MAX_BYTES + 1),
        password,
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'size-exceeded' });

    encrypted.key.destroy();
    unlocked.key.destroy();
    maximum.key.destroy();
    maximumUnlocked.key.destroy();
    maximumContent.fill(0);
    maximum.bytes.fill(0);
    maximumUnlocked.bytes.fill(0);
    maximumUnlocked.content.fill(0);
  });

  it('uses the same authentication failure for a wrong password or tampering', async () => {
    const dependencies = createDependencies();
    const encrypted = await encryptNote(
      Buffer.from('conteúdo protegido'),
      Buffer.from('senha suficientemente longa'),
      dependencies,
    );

    await expect(
      unlockEncryptedNote(
        encrypted.bytes,
        Buffer.from('senha errada mas longa'),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'authentication-failed' });

    const tampered = Buffer.from(encrypted.bytes);
    const lastByte = tampered.byteLength - 1;
    tampered[lastByte] = (tampered[lastByte] ?? 0) ^ 0x01;
    await expect(
      unlockEncryptedNote(
        tampered,
        Buffer.from('senha suficientemente longa'),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'authentication-failed' });
    expect(() => decryptEncryptedNote(tampered, encrypted.key)).toThrowError(
      expect.objectContaining({ code: 'authentication-failed' }),
    );

    encrypted.key.destroy();
  });

  it('rejects hostile metadata and noncanonical headers before deriving a key', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const encrypted = await encryptNote(
      Buffer.from('conteúdo'),
      password,
      dependencies,
    );
    const split = splitEnvelope(encrypted.bytes);
    split.header.key.kdf.N = 1_048_576;
    const hostile = rebuildEnvelope(JSON.stringify(split.header), split.ciphertext);
    const deriveKey = vi.fn(dependencies.deriveKey);

    await expect(
      unlockEncryptedNote(hostile, password, { ...dependencies, deriveKey }),
    ).rejects.toMatchObject({ code: 'invalid-envelope' });
    expect(deriveKey).not.toHaveBeenCalled();

    const noncanonical = rebuildEnvelope(
      split.headerText.replace('{', '{ '),
      split.ciphertext,
    );
    await expect(
      unlockEncryptedNote(noncanonical, password, {
        ...dependencies,
        deriveKey,
      }),
    ).rejects.toMatchObject({ code: 'invalid-envelope' });
    expect(deriveKey).not.toHaveBeenCalled();
    expect(hasEncryptedNoteSignature(hostile)).toBe(true);
    expect(hasEncryptedNoteSignature(Buffer.from('plain Markdown'))).toBe(false);

    encrypted.key.destroy();
  });

  it('rejects malformed envelope framing before deriving a key', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const encrypted = await encryptNote(
      Buffer.from('conteúdo'),
      password,
      dependencies,
    );
    const signatureBytes = Buffer.byteLength(ENCRYPTED_NOTE_SIGNATURE, 'ascii');
    const unknownVersion = Buffer.from(encrypted.bytes);
    unknownVersion[signatureBytes] = 2;
    const missingContentByte = encrypted.bytes.subarray(
      0,
      encrypted.bytes.byteLength - 1,
    );
    const split = splitEnvelope(encrypted.bytes);
    split.header.unexpected = true;
    const extraField = rebuildEnvelope(
      JSON.stringify(split.header),
      split.ciphertext,
    );
    const deriveKey = vi.fn(dependencies.deriveKey);

    for (const malformed of [
      encrypted.bytes.subarray(0, signatureBytes + 2),
      unknownVersion,
      missingContentByte,
      extraField,
    ]) {
      await expect(
        unlockEncryptedNote(malformed, password, {
          ...dependencies,
          deriveKey,
        }),
      ).rejects.toMatchObject({ code: 'invalid-envelope' });
    }
    expect(deriveKey).not.toHaveBeenCalled();
    encrypted.key.destroy();
  });

  it('rotates the content nonce while preserving the key slot', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const encrypted = await encryptNote(
      Buffer.from('versão inicial'),
      password,
      dependencies,
    );
    const before = splitEnvelope(encrypted.bytes);
    const updated = updateEncryptedNoteContent(
      encrypted.bytes,
      Buffer.from('segunda versão'),
      encrypted.key,
      dependencies,
    );
    const after = splitEnvelope(updated.bytes);

    expect(after.header.content.nonce).not.toBe(before.header.content.nonce);
    expect(updated.inspection.keySlotFingerprint).toBe(
      encrypted.inspection.keySlotFingerprint,
    );
    expect(updated.inspection.encryptionId).toBe(encrypted.inspection.encryptionId);
    const unlocked = await unlockEncryptedNote(
      updated.bytes,
      password,
      dependencies,
    );
    expect(unlocked.content.toString('utf8')).toBe('segunda versão');

    encrypted.key.destroy();
    unlocked.key.destroy();
  });

  it('changes a password by rewrapping only the note key', async () => {
    const dependencies = createDependencies();
    const currentPassword = Buffer.from('senha atual suficientemente longa');
    const nextPassword = Buffer.from('senha nova suficientemente longa');
    const encrypted = await encryptNote(
      Buffer.from('conteúdo permanece igual'),
      currentPassword,
      dependencies,
    );
    const before = splitEnvelope(encrypted.bytes);
    const changed = await changeEncryptedNotePassword(
      encrypted.bytes,
      currentPassword,
      nextPassword,
      dependencies,
    );
    const after = splitEnvelope(changed.bytes);

    expect(after.ciphertext).toEqual(before.ciphertext);
    expect(after.header.content).toEqual(before.header.content);
    expect(changed.inspection.encryptionId).toBe(
      encrypted.inspection.encryptionId,
    );
    expect(changed.inspection.keySlotFingerprint).not.toBe(
      encrypted.inspection.keySlotFingerprint,
    );
    await expect(
      unlockEncryptedNote(changed.bytes, currentPassword, dependencies),
    ).rejects.toMatchObject({ code: 'authentication-failed' });
    const unlocked = await unlockEncryptedNote(
      changed.bytes,
      nextPassword,
      dependencies,
    );
    expect(unlocked.content.toString('utf8')).toBe('conteúdo permanece igual');
    expect(() =>
      updateEncryptedNoteContent(
        changed.bytes,
        Buffer.from('não deve salvar'),
        encrypted.key,
        dependencies,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-key' }));
    expect(() => decryptEncryptedNote(changed.bytes, encrypted.key)).toThrowError(
      expect.objectContaining({ code: 'invalid-key' }),
    );

    encrypted.key.destroy();
    changed.key.destroy();
    unlocked.key.destroy();
  });

  it('zeroes internal password and derived-key buffers after use', async () => {
    let observedPassword: Buffer | undefined;
    let observedDerived: Buffer | undefined;
    let randomValue = 1;
    const encrypted = await encryptNote(
      Buffer.from('conteúdo'),
      Buffer.from('senha suficientemente longa'),
      {
        deriveKey: async (password, salt) => {
          observedPassword = password;
          observedDerived = createHash('sha256')
            .update(password)
            .update(salt)
            .digest();
          return observedDerived;
        },
        randomBytes: (size) => Buffer.alloc(size, randomValue++),
      },
    );

    expect(observedPassword).toEqual(Buffer.alloc(observedPassword?.byteLength ?? 0));
    expect(observedDerived).toEqual(Buffer.alloc(32));
    encrypted.key.destroy();
  });
});

describe('encrypted note key session', () => {
  it('isolates keys by client, project, and node and destroys removed keys', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const first = await encryptNote(Buffer.from('primeira'), password, dependencies);
    const second = await encryptNote(Buffer.from('segunda'), password, dependencies);
    const firstScope = { clientId: 4, projectId: 'project-a', nodeId: 'node-a' };
    const secondScope = { clientId: 4, projectId: 'project-b', nodeId: 'node-b' };
    const session = new EncryptedNoteKeySession();

    session.store(firstScope, first.key);
    session.store(secondScope, second.key);
    expect(session.peek(firstScope)).toBe(first.key);
    expect(session.peek({ ...firstScope, nodeId: 'other-node' })).toBeUndefined();
    expect(session.resolve(firstScope, first.inspection)).toBe(first.key);
    expect(
      session.resolve(
        { ...firstScope, clientId: 5 },
        first.inspection,
      ),
    ).toBeUndefined();
    expect(session.removeProject(4, 'project-a')).toBe(1);
    expect(first.key.destroyed).toBe(true);
    expect(session.peek(firstScope)).toBeUndefined();
    expect(second.key.destroyed).toBe(false);
    expect(session.size).toBe(1);

    session.clear();
    expect(second.key.destroyed).toBe(true);
    expect(session.size).toBe(0);
  });

  it('removes one note from every client scope', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const first = await encryptNote(Buffer.from('primeira'), password, dependencies);
    const second = await encryptNote(Buffer.from('segunda'), password, dependencies);
    const session = new EncryptedNoteKeySession();
    session.store(
      { clientId: 1, projectId: 'project', nodeId: 'node' },
      first.key,
    );
    session.store(
      { clientId: 2, projectId: 'project', nodeId: 'node' },
      second.key,
    );

    expect(session.removeNode('project', 'node')).toBe(2);
    expect(first.key.destroyed).toBe(true);
    expect(second.key.destroyed).toBe(true);
    expect(session.size).toBe(0);
  });

  it('evicts a key when the envelope key slot changes', async () => {
    const dependencies = createDependencies();
    const password = Buffer.from('senha suficientemente longa');
    const first = await encryptNote(Buffer.from('primeira'), password, dependencies);
    const second = await encryptNote(Buffer.from('segunda'), password, dependencies);
    const scope = { clientId: 'renderer', projectId: 'project', nodeId: 'node' };
    const session = new EncryptedNoteKeySession();
    session.store(scope, first.key);

    expect(session.resolve(scope, second.inspection)).toBeUndefined();
    expect(first.key.destroyed).toBe(true);
    expect(session.size).toBe(0);
    second.key.destroy();
  });
});
