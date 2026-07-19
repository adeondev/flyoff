import { createHash } from 'node:crypto';

import { MARKDOWN_DOCUMENT_MAX_BYTES } from '../../shared/contracts/projects';

export const ENCRYPTED_NOTE_SIGNATURE = 'FLYOFF-NOTE\0';
export const ENCRYPTED_NOTE_VERSION = 1 as const;
export const ENCRYPTED_NOTE_HEADER_MAX_BYTES = 16 * 1024;
export const ENCRYPTED_NOTE_MAX_DISK_BYTES =
  Buffer.byteLength(ENCRYPTED_NOTE_SIGNATURE) +
  1 +
  4 +
  ENCRYPTED_NOTE_HEADER_MAX_BYTES +
  MARKDOWN_DOCUMENT_MAX_BYTES;

export const ENCRYPTED_NOTE_KDF = Object.freeze({
  N: 131_072,
  algorithm: 'scrypt' as const,
  maxmem: 192 * 1024 * 1024,
  p: 1,
  r: 8,
});

const FORMAT = 'flyoff-encrypted-note' as const;
const CIPHER = 'aes-256-gcm' as const;
const PAGE_TYPE = 'markdown' as const;
const signatureBytes = Buffer.from(ENCRYPTED_NOTE_SIGNATURE, 'ascii');
const prefixBytes = signatureBytes.byteLength + 5;

export type EncryptedNoteErrorCode =
  | 'authentication-failed'
  | 'busy'
  | 'invalid-envelope'
  | 'invalid-key'
  | 'invalid-password'
  | 'size-exceeded';

export class EncryptedNoteError extends Error {
  readonly code: EncryptedNoteErrorCode;

  constructor(
    code: EncryptedNoteErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EncryptedNoteError';
    this.code = code;
  }
}

export interface EncryptedNoteHeaderV1 {
  cipher: typeof CIPHER;
  content: {
    nonce: string;
    plaintextBytes: number;
    tag: string;
  };
  encryptionId: string;
  format: typeof FORMAT;
  key: {
    cipher: typeof CIPHER;
    ciphertext: string;
    kdf: {
      N: typeof ENCRYPTED_NOTE_KDF.N;
      algorithm: typeof ENCRYPTED_NOTE_KDF.algorithm;
      maxmem: typeof ENCRYPTED_NOTE_KDF.maxmem;
      p: typeof ENCRYPTED_NOTE_KDF.p;
      r: typeof ENCRYPTED_NOTE_KDF.r;
      salt: string;
    };
    nonce: string;
    tag: string;
  };
  pageType: typeof PAGE_TYPE;
  version: typeof ENCRYPTED_NOTE_VERSION;
}

export interface EncryptedNoteInspection {
  contentSizeBytes: number;
  diskSizeBytes: number;
  encryptionId: string;
  keySlotFingerprint: string;
  pageType: typeof PAGE_TYPE;
  version: typeof ENCRYPTED_NOTE_VERSION;
}

export interface ParsedEncryptedNoteEnvelope {
  ciphertext: Buffer;
  header: EncryptedNoteHeaderV1;
  inspection: EncryptedNoteInspection;
}

function invalidEnvelope(message: string): never {
  throw new EncryptedNoteError('invalid-envelope', message);
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isCanonicalBase64(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const decoded = Buffer.from(value, 'base64');
  const valid =
    decoded.byteLength === expectedBytes && decoded.toString('base64') === value;
  decoded.fill(0);
  return valid;
}

function validateHeader(value: unknown): EncryptedNoteHeaderV1 {
  if (
    !isExactRecord(value, [
      'cipher',
      'content',
      'encryptionId',
      'format',
      'key',
      'pageType',
      'version',
    ]) ||
    value.cipher !== CIPHER ||
    value.format !== FORMAT ||
    value.pageType !== PAGE_TYPE ||
    value.version !== ENCRYPTED_NOTE_VERSION ||
    typeof value.encryptionId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.encryptionId)
  ) {
    return invalidEnvelope('The encrypted note header is not supported.');
  }

  const content = value.content;
  if (
    !isExactRecord(content, ['nonce', 'plaintextBytes', 'tag']) ||
    !isCanonicalBase64(content.nonce, 12) ||
    typeof content.plaintextBytes !== 'number' ||
    !Number.isSafeInteger(content.plaintextBytes) ||
    content.plaintextBytes < 0 ||
    content.plaintextBytes > MARKDOWN_DOCUMENT_MAX_BYTES ||
    !isCanonicalBase64(content.tag, 16)
  ) {
    return invalidEnvelope('The encrypted note content metadata is invalid.');
  }

  const key = value.key;
  if (
    !isExactRecord(key, ['cipher', 'ciphertext', 'kdf', 'nonce', 'tag']) ||
    key.cipher !== CIPHER ||
    !isCanonicalBase64(key.ciphertext, 32) ||
    !isCanonicalBase64(key.nonce, 12) ||
    !isCanonicalBase64(key.tag, 16)
  ) {
    return invalidEnvelope('The encrypted note key slot is invalid.');
  }

  const kdf = key.kdf;
  if (
    !isExactRecord(kdf, ['N', 'algorithm', 'maxmem', 'p', 'r', 'salt']) ||
    kdf.N !== ENCRYPTED_NOTE_KDF.N ||
    kdf.algorithm !== ENCRYPTED_NOTE_KDF.algorithm ||
    kdf.maxmem !== ENCRYPTED_NOTE_KDF.maxmem ||
    kdf.p !== ENCRYPTED_NOTE_KDF.p ||
    kdf.r !== ENCRYPTED_NOTE_KDF.r ||
    !isCanonicalBase64(kdf.salt, 16)
  ) {
    return invalidEnvelope('The encrypted note key derivation parameters are invalid.');
  }

  return {
    cipher: CIPHER,
    content: {
      nonce: content.nonce,
      plaintextBytes: content.plaintextBytes,
      tag: content.tag,
    },
    encryptionId: value.encryptionId,
    format: FORMAT,
    key: {
      cipher: CIPHER,
      ciphertext: key.ciphertext,
      kdf: {
        N: ENCRYPTED_NOTE_KDF.N,
        algorithm: ENCRYPTED_NOTE_KDF.algorithm,
        maxmem: ENCRYPTED_NOTE_KDF.maxmem,
        p: ENCRYPTED_NOTE_KDF.p,
        r: ENCRYPTED_NOTE_KDF.r,
        salt: kdf.salt,
      },
      nonce: key.nonce,
      tag: key.tag,
    },
    pageType: PAGE_TYPE,
    version: ENCRYPTED_NOTE_VERSION,
  };
}

export function serializeEncryptedNoteHeader(
  header: EncryptedNoteHeaderV1,
): string {
  return JSON.stringify({
    cipher: header.cipher,
    content: {
      nonce: header.content.nonce,
      plaintextBytes: header.content.plaintextBytes,
      tag: header.content.tag,
    },
    encryptionId: header.encryptionId,
    format: header.format,
    key: {
      cipher: header.key.cipher,
      ciphertext: header.key.ciphertext,
      kdf: {
        N: header.key.kdf.N,
        algorithm: header.key.kdf.algorithm,
        maxmem: header.key.kdf.maxmem,
        p: header.key.kdf.p,
        r: header.key.kdf.r,
        salt: header.key.kdf.salt,
      },
      nonce: header.key.nonce,
      tag: header.key.tag,
    },
    pageType: header.pageType,
    version: header.version,
  });
}

export function createEncryptedNoteContentAad(
  header: Pick<
    EncryptedNoteHeaderV1,
    'cipher' | 'content' | 'encryptionId' | 'format' | 'pageType' | 'version'
  >,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      cipher: header.cipher,
      encryptionId: header.encryptionId,
      format: header.format,
      nonce: header.content.nonce,
      pageType: header.pageType,
      plaintextBytes: header.content.plaintextBytes,
      version: header.version,
    }),
    'utf8',
  );
}

export function createEncryptedNoteKeyAad(
  header: Pick<
    EncryptedNoteHeaderV1,
    'encryptionId' | 'format' | 'key' | 'pageType' | 'version'
  >,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      cipher: header.key.cipher,
      encryptionId: header.encryptionId,
      format: header.format,
      kdf: {
        N: header.key.kdf.N,
        algorithm: header.key.kdf.algorithm,
        maxmem: header.key.kdf.maxmem,
        p: header.key.kdf.p,
        r: header.key.kdf.r,
        salt: header.key.kdf.salt,
      },
      nonce: header.key.nonce,
      pageType: header.pageType,
      version: header.version,
    }),
    'utf8',
  );
}

export function encryptedNoteKeySlotFingerprint(
  header: EncryptedNoteHeaderV1,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        cipher: header.key.cipher,
        ciphertext: header.key.ciphertext,
        kdf: {
          N: header.key.kdf.N,
          algorithm: header.key.kdf.algorithm,
          maxmem: header.key.kdf.maxmem,
          p: header.key.kdf.p,
          r: header.key.kdf.r,
          salt: header.key.kdf.salt,
        },
        nonce: header.key.nonce,
        tag: header.key.tag,
      }),
      'utf8',
    )
    .digest('hex');
}

export function hasEncryptedNoteSignature(bytes: Uint8Array): boolean {
  const buffer = asBuffer(bytes);
  return (
    buffer.byteLength >= signatureBytes.byteLength &&
    buffer.subarray(0, signatureBytes.byteLength).equals(signatureBytes)
  );
}

export function parseEncryptedNoteEnvelope(
  bytes: Uint8Array,
): ParsedEncryptedNoteEnvelope {
  const buffer = asBuffer(bytes);
  if (!hasEncryptedNoteSignature(buffer)) {
    return invalidEnvelope('The encrypted note signature is missing.');
  }

  if (buffer.byteLength < prefixBytes || buffer.byteLength > ENCRYPTED_NOTE_MAX_DISK_BYTES) {
    return invalidEnvelope('The encrypted note size is invalid.');
  }

  const versionOffset = signatureBytes.byteLength;
  if (buffer[versionOffset] !== ENCRYPTED_NOTE_VERSION) {
    return invalidEnvelope('The encrypted note version is not supported.');
  }

  const headerLength = buffer.readUInt32BE(versionOffset + 1);
  if (headerLength === 0 || headerLength > ENCRYPTED_NOTE_HEADER_MAX_BYTES) {
    return invalidEnvelope('The encrypted note header size is invalid.');
  }

  const headerStart = prefixBytes;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > buffer.byteLength) {
    return invalidEnvelope('The encrypted note header is truncated.');
  }

  const headerBytes = buffer.subarray(headerStart, headerEnd);
  const headerText = headerBytes.toString('utf8');
  if (!Buffer.from(headerText, 'utf8').equals(headerBytes)) {
    return invalidEnvelope('The encrypted note header is not valid UTF-8.');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(headerText);
  } catch (cause) {
    throw new EncryptedNoteError(
      'invalid-envelope',
      'The encrypted note header is not valid JSON.',
      { cause },
    );
  }

  const header = validateHeader(candidate);
  if (serializeEncryptedNoteHeader(header) !== headerText) {
    return invalidEnvelope('The encrypted note header is not canonical.');
  }

  const ciphertext = buffer.subarray(headerEnd);
  if (ciphertext.byteLength !== header.content.plaintextBytes) {
    return invalidEnvelope('The encrypted note content length is invalid.');
  }

  return {
    ciphertext,
    header,
    inspection: {
      contentSizeBytes: header.content.plaintextBytes,
      diskSizeBytes: buffer.byteLength,
      encryptionId: header.encryptionId,
      keySlotFingerprint: encryptedNoteKeySlotFingerprint(header),
      pageType: PAGE_TYPE,
      version: ENCRYPTED_NOTE_VERSION,
    },
  };
}

export function serializeEncryptedNoteEnvelope(
  header: EncryptedNoteHeaderV1,
  ciphertext: Uint8Array,
): Buffer {
  const validatedHeader = validateHeader(header);
  const content = asBuffer(ciphertext);
  if (content.byteLength !== validatedHeader.content.plaintextBytes) {
    return invalidEnvelope('The encrypted note content length is invalid.');
  }

  const headerBytes = Buffer.from(
    serializeEncryptedNoteHeader(validatedHeader),
    'utf8',
  );
  if (headerBytes.byteLength > ENCRYPTED_NOTE_HEADER_MAX_BYTES) {
    return invalidEnvelope('The encrypted note header exceeds the supported size.');
  }

  const prefix = Buffer.allocUnsafe(prefixBytes);
  signatureBytes.copy(prefix, 0);
  prefix[signatureBytes.byteLength] = ENCRYPTED_NOTE_VERSION;
  prefix.writeUInt32BE(headerBytes.byteLength, signatureBytes.byteLength + 1);
  const envelope = Buffer.concat([prefix, headerBytes, content]);
  if (envelope.byteLength > ENCRYPTED_NOTE_MAX_DISK_BYTES) {
    throw new EncryptedNoteError(
      'size-exceeded',
      'The encrypted note exceeds the supported size.',
    );
  }

  return envelope;
}

export function inspectEncryptedNote(
  bytes: Uint8Array,
): EncryptedNoteInspection {
  return parseEncryptedNoteEnvelope(bytes).inspection;
}
