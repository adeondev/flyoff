import {
  createCipheriv,
  createDecipheriv,
  randomBytes as secureRandomBytes,
  scrypt,
} from 'node:crypto';

import {
  MARKDOWN_DOCUMENT_MAX_BYTES,
  PROJECT_PASSWORD_MAX_BYTES,
  PROJECT_PASSWORD_MIN_LENGTH,
} from '../../shared/contracts/projects';
import {
  createEncryptedNoteContentAad,
  createEncryptedNoteKeyAad,
  ENCRYPTED_NOTE_KDF,
  ENCRYPTED_NOTE_VERSION,
  EncryptedNoteError,
  type EncryptedNoteHeaderV1,
  type EncryptedNoteInspection,
  parseEncryptedNoteEnvelope,
  serializeEncryptedNoteEnvelope,
} from './encrypted-note-format';

export const ENCRYPTED_NOTE_PASSWORD_MAX_BYTES = PROJECT_PASSWORD_MAX_BYTES;

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const RANDOM_ATTEMPTS = 8;
const MAX_PENDING_SCRYPT_OPERATIONS = 8;

export type EncryptedNoteKeyDeriver = (
  password: Buffer,
  salt: Buffer,
  parameters: typeof ENCRYPTED_NOTE_KDF,
) => Promise<Uint8Array>;

export interface EncryptedNoteCryptoDependencies {
  deriveKey?: EncryptedNoteKeyDeriver;
  randomBytes?: (size: number) => Uint8Array;
}

export interface EncryptedNoteKey {
  readonly destroyed: boolean;
  readonly encryptionId: string;
  readonly keySlotFingerprint: string;
  destroy(): void;
  matches(inspection: EncryptedNoteInspection): boolean;
}

export interface EncryptNoteResult {
  bytes: Buffer;
  inspection: EncryptedNoteInspection;
  key: EncryptedNoteKey;
}

export interface UnlockNoteResult extends EncryptNoteResult {
  content: Buffer;
}

export interface UpdateEncryptedNoteResult {
  bytes: Buffer;
  inspection: EncryptedNoteInspection;
}

class EncryptedNoteKeyHandle implements EncryptedNoteKey {
  readonly encryptionId: string;
  readonly keySlotFingerprint: string;
  #material: Buffer | null;

  constructor(material: Uint8Array, inspection: EncryptedNoteInspection) {
    this.#material = Buffer.from(material);
    this.encryptionId = inspection.encryptionId;
    this.keySlotFingerprint = inspection.keySlotFingerprint;
  }

  get destroyed(): boolean {
    return this.#material === null;
  }

  destroy(): void {
    this.#material?.fill(0);
    this.#material = null;
  }

  matches(inspection: EncryptedNoteInspection): boolean {
    return (
      !this.destroyed &&
      this.encryptionId === inspection.encryptionId &&
      this.keySlotFingerprint === inspection.keySlotFingerprint
    );
  }

  material(): Buffer {
    if (this.#material === null) {
      throw new EncryptedNoteError(
        'invalid-key',
        'The encrypted note key is no longer available.',
      );
    }

    return this.#material;
  }
}

let scryptQueue: Promise<void> = Promise.resolve();
let pendingScryptOperations = 0;

function runScryptExclusive(operation: () => Promise<Buffer>): Promise<Buffer> {
  if (pendingScryptOperations >= MAX_PENDING_SCRYPT_OPERATIONS) {
    return Promise.reject(
      new EncryptedNoteError(
        'busy',
        'Too many password operations are pending.',
      ),
    );
  }
  pendingScryptOperations += 1;
  const result = scryptQueue.then(operation, operation);
  scryptQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result.finally(() => {
    pendingScryptOperations -= 1;
  });
}

export function deriveEncryptedNoteScryptKey(
  password: Buffer,
  salt: Buffer,
  parameters: typeof ENCRYPTED_NOTE_KDF,
): Promise<Buffer> {
  if (
    parameters.N !== ENCRYPTED_NOTE_KDF.N ||
    parameters.algorithm !== ENCRYPTED_NOTE_KDF.algorithm ||
    parameters.maxmem !== ENCRYPTED_NOTE_KDF.maxmem ||
    parameters.p !== ENCRYPTED_NOTE_KDF.p ||
    parameters.r !== ENCRYPTED_NOTE_KDF.r ||
    salt.byteLength !== SALT_BYTES
  ) {
    return Promise.reject(
      new EncryptedNoteError(
        'invalid-envelope',
        'The encrypted note key derivation parameters are invalid.',
      ),
    );
  }

  return runScryptExclusive(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password,
          salt,
          KEY_BYTES,
          {
            N: parameters.N,
            maxmem: parameters.maxmem,
            p: parameters.p,
            r: parameters.r,
          },
          (error, derivedKey) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(derivedKey);
          },
        );
      }),
  );
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function validatePassword(password: Uint8Array): void {
  if (
    password.byteLength === 0 ||
    password.byteLength > ENCRYPTED_NOTE_PASSWORD_MAX_BYTES
  ) {
    throw new EncryptedNoteError(
      'invalid-password',
      'The encrypted note password size is invalid.',
    );
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(password);
  } catch (cause) {
    throw new EncryptedNoteError(
      'invalid-password',
      'The encrypted note password is not valid UTF-8.',
      { cause },
    );
  }
}

function validateNewPassword(password: Uint8Array): void {
  validatePassword(password);

  const value = new TextDecoder('utf-8', { fatal: true }).decode(password);
  if (Array.from(value).length < PROJECT_PASSWORD_MIN_LENGTH) {
    throw new EncryptedNoteError(
      'invalid-password',
      'The encrypted note password is too short.',
    );
  }
}

function copyPlaintext(content: Uint8Array): Buffer {
  if (content.byteLength > MARKDOWN_DOCUMENT_MAX_BYTES) {
    throw new EncryptedNoteError(
      'size-exceeded',
      'The note content exceeds the supported size.',
    );
  }

  return Buffer.from(content);
}

function randomExact(
  size: number,
  dependencies: EncryptedNoteCryptoDependencies,
): Buffer {
  const generated = (dependencies.randomBytes ?? secureRandomBytes)(size);
  if (!(generated instanceof Uint8Array) || generated.byteLength !== size) {
    if (generated instanceof Uint8Array) {
      asBuffer(generated).fill(0);
    }
    throw new EncryptedNoteError(
      'invalid-key',
      'The secure random provider returned an invalid value.',
    );
  }

  const result = Buffer.from(generated);
  asBuffer(generated).fill(0);
  return result;
}

function randomDifferent(
  size: number,
  previous: Buffer,
  dependencies: EncryptedNoteCryptoDependencies,
): Buffer {
  for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt += 1) {
    const generated = randomExact(size, dependencies);
    if (!generated.equals(previous)) {
      return generated;
    }
    generated.fill(0);
  }

  throw new EncryptedNoteError(
    'invalid-key',
    'The secure random provider repeated a nonce or salt.',
  );
}

async function derivePasswordKey(
  password: Uint8Array,
  salt: Buffer,
  dependencies: EncryptedNoteCryptoDependencies,
): Promise<Buffer> {
  validatePassword(password);
  const secret = Buffer.from(password);
  let derived: Uint8Array | undefined;

  try {
    derived = await (dependencies.deriveKey ?? deriveEncryptedNoteScryptKey)(
      secret,
      salt,
      ENCRYPTED_NOTE_KDF,
    );
    if (!(derived instanceof Uint8Array) || derived.byteLength !== KEY_BYTES) {
      throw new EncryptedNoteError(
        'invalid-key',
        'The encrypted note key derivation result is invalid.',
      );
    }

    return Buffer.from(derived);
  } finally {
    secret.fill(0);
    if (derived instanceof Uint8Array) {
      asBuffer(derived).fill(0);
    }
  }
}

function encryptGcm(
  plaintext: Buffer,
  key: Buffer,
  nonce: Buffer,
  aad: Buffer,
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-256-gcm', key, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aad, { plaintextLength: plaintext.byteLength });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

function decryptGcm(
  ciphertext: Buffer,
  key: Buffer,
  nonce: Buffer,
  tag: Buffer,
  aad: Buffer,
): Buffer {
  let updated: Buffer | undefined;
  let finalized: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad, { plaintextLength: ciphertext.byteLength });
    decipher.setAuthTag(tag);
    updated = decipher.update(ciphertext);
    finalized = decipher.final();
    const plaintext = Buffer.allocUnsafe(updated.byteLength + finalized.byteLength);
    updated.copy(plaintext);
    finalized.copy(plaintext, updated.byteLength);
    return plaintext;
  } catch (cause) {
    throw new EncryptedNoteError(
      'authentication-failed',
      'The encrypted note could not be authenticated.',
      { cause },
    );
  } finally {
    updated?.fill(0);
    finalized?.fill(0);
  }
}

function headerTemplate(
  encryptionId: string,
  plaintextBytes: number,
  contentNonce: Buffer,
  salt: Buffer,
  keyNonce: Buffer,
): EncryptedNoteHeaderV1 {
  return {
    cipher: 'aes-256-gcm',
    content: {
      nonce: contentNonce.toString('base64'),
      plaintextBytes,
      tag: Buffer.alloc(TAG_BYTES).toString('base64'),
    },
    encryptionId,
    format: 'flyoff-encrypted-note',
    key: {
      cipher: 'aes-256-gcm',
      ciphertext: Buffer.alloc(KEY_BYTES).toString('base64'),
      kdf: {
        ...ENCRYPTED_NOTE_KDF,
        salt: salt.toString('base64'),
      },
      nonce: keyNonce.toString('base64'),
      tag: Buffer.alloc(TAG_BYTES).toString('base64'),
    },
    pageType: 'markdown',
    version: ENCRYPTED_NOTE_VERSION,
  };
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

async function unwrapKey(
  header: EncryptedNoteHeaderV1,
  password: Uint8Array,
  dependencies: EncryptedNoteCryptoDependencies,
): Promise<Buffer> {
  const salt = decode(header.key.kdf.salt);
  const nonce = decode(header.key.nonce);
  const tag = decode(header.key.tag);
  const wrappedKey = decode(header.key.ciphertext);
  const aad = createEncryptedNoteKeyAad(header);
  let passwordKey: Buffer | undefined;

  try {
    passwordKey = await derivePasswordKey(password, salt, dependencies);
    return decryptGcm(wrappedKey, passwordKey, nonce, tag, aad);
  } finally {
    salt.fill(0);
    nonce.fill(0);
    tag.fill(0);
    wrappedKey.fill(0);
    aad.fill(0);
    passwordKey?.fill(0);
  }
}

function decryptContent(
  parsed: ReturnType<typeof parseEncryptedNoteEnvelope>,
  key: Buffer,
): Buffer {
  const nonce = decode(parsed.header.content.nonce);
  const tag = decode(parsed.header.content.tag);
  const aad = createEncryptedNoteContentAad(parsed.header);

  try {
    return decryptGcm(parsed.ciphertext, key, nonce, tag, aad);
  } finally {
    nonce.fill(0);
    tag.fill(0);
    aad.fill(0);
  }
}

function keyMaterial(
  key: EncryptedNoteKey,
  inspection: EncryptedNoteInspection,
): Buffer {
  if (!(key instanceof EncryptedNoteKeyHandle) || !key.matches(inspection)) {
    throw new EncryptedNoteError(
      'invalid-key',
      'The encrypted note key does not match this envelope.',
    );
  }

  return key.material();
}

export async function encryptNote(
  content: Uint8Array,
  password: Uint8Array,
  dependencies: EncryptedNoteCryptoDependencies = {},
): Promise<EncryptNoteResult> {
  validateNewPassword(password);
  let plaintext: Buffer | undefined;
  let encryptionIdBytes: Buffer | undefined;
  let salt: Buffer | undefined;
  let keyNonce: Buffer | undefined;
  let contentNonce: Buffer | undefined;
  let noteKey: Buffer | undefined;
  let passwordKey: Buffer | undefined;
  let keyHandle: EncryptedNoteKeyHandle | undefined;
  let contentCiphertext: Buffer | undefined;
  let contentTag: Buffer | undefined;
  let wrappedKeyCiphertext: Buffer | undefined;
  let wrappedKeyTag: Buffer | undefined;

  try {
    plaintext = copyPlaintext(content);
    encryptionIdBytes = randomExact(16, dependencies);
    salt = randomExact(SALT_BYTES, dependencies);
    keyNonce = randomExact(NONCE_BYTES, dependencies);
    contentNonce = randomExact(NONCE_BYTES, dependencies);
    noteKey = randomExact(KEY_BYTES, dependencies);
    const header = headerTemplate(
      encryptionIdBytes.toString('hex'),
      plaintext.byteLength,
      contentNonce,
      salt,
      keyNonce,
    );
    const contentAad = createEncryptedNoteContentAad(header);
    const encryptedContent = encryptGcm(
      plaintext,
      noteKey,
      contentNonce,
      contentAad,
    );
    contentCiphertext = encryptedContent.ciphertext;
    contentTag = encryptedContent.tag;
    contentAad.fill(0);

    passwordKey = await derivePasswordKey(password, salt, dependencies);
    const keyAad = createEncryptedNoteKeyAad(header);
    const wrappedKey = encryptGcm(noteKey, passwordKey, keyNonce, keyAad);
    wrappedKeyCiphertext = wrappedKey.ciphertext;
    wrappedKeyTag = wrappedKey.tag;
    keyAad.fill(0);

    header.content.tag = contentTag.toString('base64');
    header.key.ciphertext = wrappedKeyCiphertext.toString('base64');
    header.key.tag = wrappedKeyTag.toString('base64');

    const bytes = serializeEncryptedNoteEnvelope(header, contentCiphertext);
    const inspection = parseEncryptedNoteEnvelope(bytes).inspection;
    keyHandle = new EncryptedNoteKeyHandle(noteKey, inspection);
    return { bytes, inspection, key: keyHandle };
  } catch (error) {
    keyHandle?.destroy();
    throw error;
  } finally {
    plaintext?.fill(0);
    encryptionIdBytes?.fill(0);
    salt?.fill(0);
    keyNonce?.fill(0);
    contentNonce?.fill(0);
    noteKey?.fill(0);
    passwordKey?.fill(0);
    contentCiphertext?.fill(0);
    contentTag?.fill(0);
    wrappedKeyCiphertext?.fill(0);
    wrappedKeyTag?.fill(0);
  }
}

export async function unlockEncryptedNote(
  bytes: Uint8Array,
  password: Uint8Array,
  dependencies: EncryptedNoteCryptoDependencies = {},
): Promise<UnlockNoteResult> {
  const parsed = parseEncryptedNoteEnvelope(bytes);
  validatePassword(password);
  const noteKey = await unwrapKey(parsed.header, password, dependencies);
  let keyHandle: EncryptedNoteKeyHandle | undefined;
  let content: Buffer | undefined;

  try {
    content = decryptContent(parsed, noteKey);
    keyHandle = new EncryptedNoteKeyHandle(noteKey, parsed.inspection);
    return {
      bytes: Buffer.from(bytes),
      content,
      inspection: parsed.inspection,
      key: keyHandle,
    };
  } catch (error) {
    keyHandle?.destroy();
    content?.fill(0);
    throw error;
  } finally {
    noteKey.fill(0);
  }
}

export function decryptEncryptedNote(
  bytes: Uint8Array,
  key: EncryptedNoteKey,
): Buffer {
  const parsed = parseEncryptedNoteEnvelope(bytes);
  return decryptContent(parsed, keyMaterial(key, parsed.inspection));
}

export function updateEncryptedNoteContent(
  bytes: Uint8Array,
  content: Uint8Array,
  key: EncryptedNoteKey,
  dependencies: Pick<EncryptedNoteCryptoDependencies, 'randomBytes'> = {},
): UpdateEncryptedNoteResult {
  const parsed = parseEncryptedNoteEnvelope(bytes);
  const material = keyMaterial(key, parsed.inspection);
  let plaintext: Buffer | undefined;
  let currentNonce: Buffer | undefined;
  let nextNonce: Buffer | undefined;
  let previousContent: Buffer | undefined;
  let aad: Buffer | undefined;
  let ciphertext: Buffer | undefined;
  let tag: Buffer | undefined;

  try {
    plaintext = copyPlaintext(content);
    currentNonce = decode(parsed.header.content.nonce);
    nextNonce = randomDifferent(
      NONCE_BYTES,
      currentNonce,
      dependencies,
    );
    previousContent = decryptContent(parsed, material);
    const header: EncryptedNoteHeaderV1 = {
      ...parsed.header,
      content: {
        nonce: nextNonce.toString('base64'),
        plaintextBytes: plaintext.byteLength,
        tag: Buffer.alloc(TAG_BYTES).toString('base64'),
      },
    };
    aad = createEncryptedNoteContentAad(header);
    const encrypted = encryptGcm(plaintext, material, nextNonce, aad);
    ciphertext = encrypted.ciphertext;
    tag = encrypted.tag;
    header.content.tag = tag.toString('base64');
    const nextBytes = serializeEncryptedNoteEnvelope(header, ciphertext);
    return {
      bytes: nextBytes,
      inspection: parseEncryptedNoteEnvelope(nextBytes).inspection,
    };
  } finally {
    plaintext?.fill(0);
    currentNonce?.fill(0);
    nextNonce?.fill(0);
    previousContent?.fill(0);
    aad?.fill(0);
    ciphertext?.fill(0);
    tag?.fill(0);
  }
}

export async function changeEncryptedNotePassword(
  bytes: Uint8Array,
  currentPassword: Uint8Array,
  nextPassword: Uint8Array,
  dependencies: EncryptedNoteCryptoDependencies = {},
): Promise<EncryptNoteResult> {
  validatePassword(currentPassword);
  validateNewPassword(nextPassword);
  const parsed = parseEncryptedNoteEnvelope(bytes);
  let noteKey: Buffer | undefined;
  let verifiedContent: Buffer | undefined;
  let currentSalt: Buffer | undefined;
  let currentNonce: Buffer | undefined;
  let nextSalt: Buffer | undefined;
  let nextNonce: Buffer | undefined;
  let nextPasswordKey: Buffer | undefined;
  let keyHandle: EncryptedNoteKeyHandle | undefined;
  let aad: Buffer | undefined;
  let wrappedKeyCiphertext: Buffer | undefined;
  let wrappedKeyTag: Buffer | undefined;

  try {
    noteKey = await unwrapKey(parsed.header, currentPassword, dependencies);
    verifiedContent = decryptContent(parsed, noteKey);
    currentSalt = decode(parsed.header.key.kdf.salt);
    currentNonce = decode(parsed.header.key.nonce);
    nextSalt = randomDifferent(SALT_BYTES, currentSalt, dependencies);
    nextNonce = randomDifferent(NONCE_BYTES, currentNonce, dependencies);
    const header: EncryptedNoteHeaderV1 = {
      ...parsed.header,
      key: {
        cipher: 'aes-256-gcm',
        ciphertext: Buffer.alloc(KEY_BYTES).toString('base64'),
        kdf: {
          ...ENCRYPTED_NOTE_KDF,
          salt: nextSalt.toString('base64'),
        },
        nonce: nextNonce.toString('base64'),
        tag: Buffer.alloc(TAG_BYTES).toString('base64'),
      },
    };
    nextPasswordKey = await derivePasswordKey(
      nextPassword,
      nextSalt,
      dependencies,
    );
    aad = createEncryptedNoteKeyAad(header);
    const wrappedKey = encryptGcm(noteKey, nextPasswordKey, nextNonce, aad);
    wrappedKeyCiphertext = wrappedKey.ciphertext;
    wrappedKeyTag = wrappedKey.tag;
    header.key.ciphertext = wrappedKeyCiphertext.toString('base64');
    header.key.tag = wrappedKeyTag.toString('base64');

    const nextBytes = serializeEncryptedNoteEnvelope(header, parsed.ciphertext);
    const inspection = parseEncryptedNoteEnvelope(nextBytes).inspection;
    keyHandle = new EncryptedNoteKeyHandle(noteKey, inspection);
    return { bytes: nextBytes, inspection, key: keyHandle };
  } catch (error) {
    keyHandle?.destroy();
    throw error;
  } finally {
    noteKey?.fill(0);
    verifiedContent?.fill(0);
    currentSalt?.fill(0);
    currentNonce?.fill(0);
    nextSalt?.fill(0);
    nextNonce?.fill(0);
    nextPasswordKey?.fill(0);
    aad?.fill(0);
    wrappedKeyCiphertext?.fill(0);
    wrappedKeyTag?.fill(0);
  }
}
