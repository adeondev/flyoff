import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  isSpellcheckWordRequest,
  SPELLCHECK_WORD_BATCH_LIMIT,
} from '../../../shared/contracts';

const PERSONAL_DICTIONARY_FILENAME = 'spellcheck-personal.json';
const PERSONAL_DICTIONARY_MAX_BYTES = 256 * 1_024;

function normalizeWords(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (word): word is string =>
          typeof word === 'string' &&
          isSpellcheckWordRequest({ word: word.trim() }),
      ),
    ),
  ].slice(0, SPELLCHECK_WORD_BATCH_LIMIT);
}

export class PersonalDictionaryStore {
  readonly filePath: string;

  private words: readonly string[];

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, PERSONAL_DICTIONARY_FILENAME);
    this.words = this.load();
  }

  get(): readonly string[] {
    return [...this.words];
  }

  add(word: string): boolean {
    const normalized = word.trim();
    if (
      !isSpellcheckWordRequest({ word: normalized }) ||
      this.words.includes(normalized)
    ) {
      return this.words.includes(normalized);
    }

    const next = normalizeWords([...this.words, normalized]);
    if (!next.includes(normalized)) {
      return false;
    }
    this.write(next);
    this.words = next;
    return true;
  }

  private load(): readonly string[] {
    try {
      if (statSync(this.filePath).size > PERSONAL_DICTIONARY_MAX_BYTES) {
        return [];
      }
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return normalizeWords(value);
    } catch {
      return [];
    }
  }

  private write(words: readonly string[]): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const serialized = `${JSON.stringify(words, null, 2)}\n`;
    if (
      Buffer.byteLength(serialized, 'utf8') >
      PERSONAL_DICTIONARY_MAX_BYTES
    ) {
      throw new RangeError('The personal dictionary exceeds its size limit.');
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
