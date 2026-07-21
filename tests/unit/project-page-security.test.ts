import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  EncryptedNoteCryptoDependencies,
  EncryptedNoteKey,
} from '../../src/main/projects/encrypted-note-crypto';
import {
  ENCRYPTED_NOTE_SIGNATURE,
  hasEncryptedNoteSignature,
} from '../../src/main/projects/encrypted-note-format';
import type { EncryptedNoteKeySession } from '../../src/main/projects/encrypted-note-key-session';
import {
  ProjectCatalogStore,
  ProjectRepository,
  ProjectService,
} from '../../src/main/projects';

const currentPassword = 'senha atual muito segura';
const nextPassword = 'senha nova ainda mais segura';
const temporaryDirectories: string[] = [];

const fastCrypto: EncryptedNoteCryptoDependencies = {
  deriveKey: async (password, salt) =>
    createHash('sha256').update(password).update(salt).digest(),
};

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flyoff-security-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRepository(): Promise<ProjectRepository> {
  const parent = createTemporaryDirectory();
  return ProjectRepository.create(
    path.join(parent, 'Projeto Seguro'),
    'Projeto Seguro',
    { encryptedNoteCrypto: fastCrypto },
  );
}

function notePath(repository: ProjectRepository, name: string): string {
  return path.join(repository.rootPath, `${name}.md`);
}

function sessionOf(service: ProjectService): EncryptedNoteKeySession {
  return (service as unknown as { noteKeys: EncryptedNoteKeySession }).noteKeys;
}

function sessionKey(
  service: ProjectService,
  clientId: number,
  projectId: string,
  nodeId: string,
): EncryptedNoteKey | undefined {
  return sessionOf(service).peek({ clientId, projectId, nodeId });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectRepository protected Markdown pages', () => {
  it('protects, unlocks, saves, rotates credentials, and removes protection', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Segredo');
    const initial = await repository.readMarkdown(note.nodeId);
    const plaintext = '# ConteÃºdo confidencial Ãºnico\n';
    const savedPlaintext = await repository.saveMarkdown(
      note.nodeId,
      plaintext,
      initial.revision,
    );
    const protectedPage = await repository.protectPage(
      note.nodeId,
      currentPassword,
      savedPlaintext.revision,
    );
    const encryptedBytes = readFileSync(notePath(repository, 'Segredo'));

    expect(hasEncryptedNoteSignature(encryptedBytes)).toBe(true);
    expect(encryptedBytes.includes(Buffer.from(plaintext, 'utf8'))).toBe(false);
    expect(protectedPage.properties).toMatchObject({
      contentSizeBytes: Buffer.byteLength(plaintext),
      passwordProtected: true,
      locked: false,
      readOnly: false,
    });
    await expect(repository.getPageProperties(note.nodeId)).resolves.toMatchObject({
      passwordProtected: true,
      locked: true,
    });
    await expect(repository.readMarkdown(note.nodeId)).rejects.toMatchObject({
      code: 'password-required',
    });
    await expect(
      repository.unlockPage(note.nodeId, 'senha incorreta e longa'),
    ).rejects.toMatchObject({
      code: 'authentication-failed',
      message: 'Incorrect password or damaged file.',
    });

    const unlocked = await repository.unlockPage(note.nodeId, currentPassword);
    expect(unlocked.document.content).toBe(plaintext);
    const updatedContent = `${plaintext}\nSegunda versÃ£o.`;
    const savedEncrypted = await repository.saveMarkdown(
      note.nodeId,
      updatedContent,
      unlocked.document.revision,
      false,
      unlocked.key,
    );
    const nextEncryptedBytes = readFileSync(notePath(repository, 'Segredo'));
    expect(nextEncryptedBytes).not.toEqual(encryptedBytes);
    expect(nextEncryptedBytes.includes(Buffer.from(updatedContent, 'utf8'))).toBe(
      false,
    );

    const readOnly = await repository.setPageReadOnly(
      note.nodeId,
      true,
      savedEncrypted.revision,
      unlocked.key,
    );
    expect(readOnly.readOnly).toBe(true);
    await expect(
      repository.saveMarkdown(
        note.nodeId,
        'sobrescrita forÃ§ada',
        savedEncrypted.revision,
        true,
        unlocked.key,
      ),
    ).rejects.toMatchObject({ code: 'read-only' });
    await expect(
      repository.readMarkdown(note.nodeId, unlocked.key),
    ).resolves.toMatchObject({ readOnly: true, content: updatedContent });
    const writable = await repository.setPageReadOnly(
      note.nodeId,
      false,
      readOnly.revision,
      unlocked.key,
    );

    const changed = await repository.changePagePassword(
      note.nodeId,
      currentPassword,
      nextPassword,
      writable.revision,
    );
    await expect(
      repository.unlockPage(note.nodeId, currentPassword),
    ).rejects.toMatchObject({ code: 'authentication-failed' });
    await expect(
      repository.readMarkdown(note.nodeId, protectedPage.key),
    ).rejects.toMatchObject({ code: 'password-required' });
    await expect(
      repository.readMarkdown(note.nodeId, changed.key),
    ).resolves.toMatchObject({ content: updatedContent });

    const removed = await repository.removePagePassword(
      note.nodeId,
      nextPassword,
      changed.properties.revision,
    );
    expect(removed).toMatchObject({
      passwordProtected: false,
      locked: false,
      contentSizeBytes: Buffer.byteLength(updatedContent),
    });
    expect(readFileSync(notePath(repository, 'Segredo'), 'utf8')).toBe(
      updatedContent,
    );
    await expect(repository.readMarkdown(note.nodeId)).resolves.toMatchObject({
      content: updatedContent,
      revision: removed.revision,
      readOnly: false,
    });

    protectedPage.key.destroy();
    unlocked.key.destroy();
    changed.key.destroy();
  });

  it('rejects tampering and stale revisions without replacing the damaged file', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Adulterada');
    const initial = await repository.readMarkdown(note.nodeId);
    const saved = await repository.saveMarkdown(
      note.nodeId,
      'conteÃºdo autenticado',
      initial.revision,
    );
    const protectedPage = await repository.protectPage(
      note.nodeId,
      currentPassword,
      saved.revision,
    );
    const absolutePath = notePath(repository, 'Adulterada');
    const tampered = readFileSync(absolutePath);
    tampered[tampered.byteLength - 1] =
      (tampered[tampered.byteLength - 1] ?? 0) ^ 0x01;
    writeFileSync(absolutePath, tampered);

    await expect(
      repository.unlockPage(note.nodeId, currentPassword),
    ).rejects.toMatchObject({ code: 'authentication-failed' });
    await expect(
      repository.readMarkdown(note.nodeId, protectedPage.key),
    ).rejects.toMatchObject({ code: 'authentication-failed' });
    await expect(
      repository.removePagePassword(
        note.nodeId,
        currentPassword,
        protectedPage.properties.revision,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.setPageReadOnly(
        note.nodeId,
        true,
        protectedPage.properties.revision,
        protectedPage.key,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      repository.saveMarkdown(
        note.nodeId,
        'nÃ£o deve substituir',
        protectedPage.properties.revision,
        true,
        protectedPage.key,
      ),
    ).rejects.toMatchObject({ code: 'authentication-failed' });
    expect(readFileSync(absolutePath)).toEqual(tampered);
    protectedPage.key.destroy();
  });

  it('performs the second revision check even for a forced save', async () => {
    const parent = createTemporaryDirectory();
    const rootPath = path.join(parent, 'Projeto Concorrente');
    const racedPath = path.join(rootPath, 'Concorrente.md');
    let raceArmed = false;
    const repository = await ProjectRepository.create(
      rootPath,
      'Projeto Concorrente',
      {
        createId: () => {
          if (raceArmed) {
            raceArmed = false;
            writeFileSync(racedPath, 'alteraÃ§Ã£o externa durante o save', 'utf8');
          }
          return randomUUID();
        },
        encryptedNoteCrypto: fastCrypto,
      },
    );
    const note = await repository.createMarkdownPage(null, 'Concorrente');
    const initial = await repository.readMarkdown(note.nodeId);
    raceArmed = true;

    await expect(
      repository.saveMarkdown(
        note.nodeId,
        'conteÃºdo local forÃ§ado',
        initial.revision,
        true,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(readFileSync(racedPath, 'utf8')).toBe(
      'alteraÃ§Ã£o externa durante o save',
    );
    expect(readdirSync(rootPath).some((name) => name.endsWith('.tmp'))).toBe(
      false,
    );
  });

  it('rebuilds the index around an encrypted note without re-encrypting it', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Recuperada');
    const initial = await repository.readMarkdown(note.nodeId);
    const saved = await repository.saveMarkdown(
      note.nodeId,
      '# Conteúdo preservado',
      initial.revision,
    );
    const protectedPage = await repository.protectPage(
      note.nodeId,
      currentPassword,
      saved.revision,
    );
    const encryptedPath = notePath(repository, 'Recuperada');
    const encryptedBytes = readFileSync(encryptedPath);
    protectedPage.key.destroy();
    rmSync(path.join(repository.rootPath, '.flyoff', 'content-index.json'));

    const reopened = await ProjectRepository.open(repository.rootPath, {
      encryptedNoteCrypto: fastCrypto,
    });
    const rebuiltNote = (await reopened.listChildren(null)).find(
      (candidate) =>
        candidate.kind === 'page' && candidate.name === 'Recuperada',
    );

    expect(rebuiltNote?.nodeId).toBeTruthy();
    expect(readFileSync(encryptedPath)).toEqual(encryptedBytes);
    await expect(
      reopened.getPageProperties(rebuiltNote!.nodeId),
    ).resolves.toMatchObject({ passwordProtected: true, locked: true });
    const unlocked = await reopened.unlockPage(
      rebuiltNote!.nodeId,
      currentPassword,
    );
    expect(unlocked.document.content).toBe('# Conteúdo preservado');
    unlocked.key.destroy();
  });

  it('migrates legacy metadata only on mutation and orders the compatibility barrier', async () => {
    const repository = await createRepository();
    const note = await repository.createMarkdownPage(null, 'Legada');
    const manifestPath = path.join(
      repository.rootPath,
      '.flyoff',
      'project.json',
    );
    const indexPath = path.join(
      repository.rootPath,
      '.flyoff',
      'content-index.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      formatVersion: number;
    };
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      formatVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    manifest.formatVersion = 1;
    index.formatVersion = 2;
    for (const entry of index.entries) {
      delete entry.attributes;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(indexPath, JSON.stringify(index));

    const reopened = await ProjectRepository.open(repository.rootPath, {
      encryptedNoteCrypto: fastCrypto,
    });
    expect(
      (JSON.parse(readFileSync(manifestPath, 'utf8')) as { formatVersion: number })
        .formatVersion,
    ).toBe(1);
    expect(
      (JSON.parse(readFileSync(indexPath, 'utf8')) as { formatVersion: number })
        .formatVersion,
    ).toBe(2);

    const document = await reopened.readMarkdown(note.nodeId);
    const protectedPage = await reopened.protectPage(
      note.nodeId,
      currentPassword,
      document.revision,
    );
    expect(reopened.summary.formatVersion).toBe(2);
    expect(
      (JSON.parse(readFileSync(manifestPath, 'utf8')) as { formatVersion: number })
        .formatVersion,
    ).toBe(2);
    expect(
      (JSON.parse(readFileSync(indexPath, 'utf8')) as { formatVersion: number })
        .formatVersion,
    ).toBe(2);
    expect(
      readFileSync(notePath(reopened, 'Legada')).subarray(
        0,
        Buffer.byteLength(ENCRYPTED_NOTE_SIGNATURE),
      ),
    ).toEqual(Buffer.from(ENCRYPTED_NOTE_SIGNATURE, 'ascii'));

    await reopened.setPageReadOnly(
      note.nodeId,
      true,
      protectedPage.properties.revision,
      protectedPage.key,
    );
    const migratedIndex = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      formatVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(migratedIndex.formatVersion).toBe(4);
    expect(
      migratedIndex.entries.find((entry) => entry.nodeId === note.nodeId),
    ).toMatchObject({ attributes: { readOnly: true } });
    protectedPage.key.destroy();
  });
});

describe('ProjectService protected-note key lifecycle', () => {
  it('destroys a stale key when an encrypted note is replaced by plaintext', async () => {
    const parent = createTemporaryDirectory();
    const service = new ProjectService({
      catalogStore: new ProjectCatalogStore(path.join(parent, 'user-data')),
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
      encryptedNoteCrypto: fastCrypto,
    });
    const selection = await service.selectCreateLocation(1, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const created = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Substituição Externa',
    });
    if (!created.ok) {
      throw new Error('Expected project creation to succeed.');
    }
    const createdNode = await service.createNode(1, {
      parentId: null,
      name: 'Substituída',
      kind: 'page',
      pageType: 'markdown',
    });
    if (!createdNode.ok) {
      throw new Error('Expected note creation to succeed.');
    }
    const nodeId = createdNode.value.nodeId;
    const initial = await service.readMarkdown(1, { nodeId });
    if (!initial.ok) {
      throw new Error('Expected the note to be readable.');
    }
    const protectedPage = await service.protectPage(1, {
      nodeId,
      expectedRevision: initial.value.revision,
      password: currentPassword,
    });
    if (!protectedPage.ok) {
      throw new Error('Expected password protection to succeed.');
    }
    const staleKey = sessionKey(
      service,
      1,
      created.value.projectId,
      nodeId,
    );
    expect(staleKey).toBeDefined();

    writeFileSync(
      path.join(created.value.location, 'Substituída.md'),
      '# Conteúdo externo em texto simples\n',
      'utf8',
    );
    await expect(
      service.getPageProperties(1, { nodeId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { passwordProtected: false, locked: false },
    });

    expect(staleKey?.destroyed).toBe(true);
    expect(
      sessionKey(service, 1, created.value.projectId, nodeId),
    ).toBeUndefined();
    expect(sessionOf(service).size).toBe(0);
    service.dispose();
  });

  it('serializes a concurrent protect and lock without retaining the adopted key', async () => {
    const parent = createTemporaryDirectory();
    const service = new ProjectService({
      catalogStore: new ProjectCatalogStore(path.join(parent, 'user-data')),
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
      encryptedNoteCrypto: fastCrypto,
    });
    const selection = await service.selectCreateLocation(1, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const created = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Proteção Concorrente',
    });
    if (!created.ok) {
      throw new Error('Expected project creation to succeed.');
    }
    const createdNode = await service.createNode(1, {
      parentId: null,
      name: 'Concorrente',
      kind: 'page',
      pageType: 'markdown',
    });
    if (!createdNode.ok) {
      throw new Error('Expected note creation to succeed.');
    }
    const nodeId = createdNode.value.nodeId;
    const initial = await service.readMarkdown(1, { nodeId });
    if (!initial.ok) {
      throw new Error('Expected the note to be readable.');
    }
    const adoptedKeys: EncryptedNoteKey[] = [];
    const keySession = sessionOf(service);
    const store = keySession.store.bind(keySession);
    vi.spyOn(keySession, 'store').mockImplementation((scope, key) => {
      adoptedKeys.push(key);
      store(scope, key);
    });

    const protection = service.protectPage(1, {
      nodeId,
      expectedRevision: initial.value.revision,
      password: currentPassword,
    });
    const lock = service.lockPage(1, { nodeId });
    await expect(Promise.all([protection, lock])).resolves.toMatchObject([
      { ok: true },
      { ok: true, value: null },
    ]);

    expect(adoptedKeys).toHaveLength(1);
    expect(adoptedKeys[0]?.destroyed).toBe(true);
    expect(sessionOf(service).size).toBe(0);
    await expect(service.readMarkdown(1, { nodeId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'password-required' },
    });
    service.dispose();
  });

  it('isolates renderers and destroys keys on rotate, lock, removal, reopen, and disposal', async () => {
    const parent = createTemporaryDirectory();
    const service = new ProjectService({
      catalogStore: new ProjectCatalogStore(path.join(parent, 'user-data')),
      trashItem: (absolutePath) =>
        rm(absolutePath, { recursive: true, force: true }),
      encryptedNoteCrypto: fastCrypto,
    });
    const selection = await service.selectCreateLocation(1, parent);
    if (!selection.ok) {
      throw new Error('Expected a valid project location.');
    }
    const created = await service.createProject(1, {
      selectionToken: selection.value.token,
      name: 'Compartilhado Seguro',
    });
    if (!created.ok) {
      throw new Error('Expected project creation to succeed.');
    }
    await service.openProject(2, created.value.location);
    const createdNode = await service.createNode(1, {
      parentId: null,
      name: 'Privada',
      kind: 'page',
      pageType: 'markdown',
    });
    if (!createdNode.ok) {
      throw new Error('Expected note creation to succeed.');
    }
    const nodeId = createdNode.value.nodeId;
    const initial = await service.readMarkdown(1, { nodeId });
    if (!initial.ok) {
      throw new Error('Expected the note to be readable.');
    }

    const protectedPage = await service.protectPage(1, {
      nodeId,
      expectedRevision: initial.value.revision,
      password: currentPassword,
    });
    if (!protectedPage.ok) {
      throw new Error('Expected password protection to succeed.');
    }
    const firstKey = sessionKey(
      service,
      1,
      created.value.projectId,
      nodeId,
    );
    expect(firstKey).toBeDefined();
    await expect(service.readMarkdown(2, { nodeId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'password-required' },
    });
    await expect(
      service.unlockPage(2, {
        nodeId,
        password: 'senha incorreta e longa',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'authentication-failed' },
    });
    const unlockedSecond = await service.unlockPage(2, {
      nodeId,
      password: currentPassword,
    });
    expect(unlockedSecond.ok).toBe(true);
    const secondKey = sessionKey(
      service,
      2,
      created.value.projectId,
      nodeId,
    );
    expect(secondKey).toBeDefined();

    const changed = await service.changePagePassword(1, {
      nodeId,
      expectedRevision: protectedPage.value.revision,
      currentPassword,
      newPassword: nextPassword,
    });
    expect(changed.ok).toBe(true);
    expect(firstKey?.destroyed).toBe(true);
    expect(secondKey?.destroyed).toBe(true);
    expect(sessionKey(service, 2, created.value.projectId, nodeId)).toBeUndefined();
    await expect(service.readMarkdown(2, { nodeId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'password-required' },
    });

    const unlockedAgain = await service.unlockPage(2, {
      nodeId,
      password: nextPassword,
    });
    expect(unlockedAgain.ok).toBe(true);
    const keyBeforeLock = sessionKey(
      service,
      2,
      created.value.projectId,
      nodeId,
    );
    await expect(service.lockPage(2, { nodeId })).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(keyBeforeLock?.destroyed).toBe(true);
    await expect(service.readMarkdown(2, { nodeId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'password-required' },
    });
    await service.unlockPage(2, { nodeId, password: nextPassword });
    const secondKeyBeforeRemoval = sessionKey(
      service,
      2,
      created.value.projectId,
      nodeId,
    );
    const currentFirstKey = sessionKey(
      service,
      1,
      created.value.projectId,
      nodeId,
    );
    if (!changed.ok) {
      throw new Error('Expected password rotation to succeed.');
    }
    const removed = await service.removePagePassword(1, {
      nodeId,
      expectedRevision: changed.value.revision,
      password: nextPassword,
    });
    expect(removed).toMatchObject({
      ok: true,
      value: { passwordProtected: false, locked: false },
    });
    expect(currentFirstKey?.destroyed).toBe(true);
    expect(secondKeyBeforeRemoval?.destroyed).toBe(true);
    await expect(service.readMarkdown(1, { nodeId })).resolves.toMatchObject({
      ok: true,
    });
    await expect(service.readMarkdown(2, { nodeId })).resolves.toMatchObject({
      ok: true,
    });
    await expect(service.lockPage(2, { nodeId })).resolves.toEqual({
      ok: true,
      value: null,
    });

    if (!removed.ok) {
      throw new Error('Expected password removal to succeed.');
    }
    const protectedAgain = await service.protectPage(1, {
      nodeId,
      expectedRevision: removed.value.revision,
      password: currentPassword,
    });
    expect(protectedAgain.ok).toBe(true);
    const keyBeforeReopen = sessionKey(
      service,
      1,
      created.value.projectId,
      nodeId,
    );
    await service.openProject(1, created.value.location);
    expect(keyBeforeReopen?.destroyed).toBe(true);
    await expect(service.readMarkdown(1, { nodeId })).resolves.toMatchObject({
      ok: false,
      error: { code: 'password-required' },
    });
    await service.unlockPage(1, { nodeId, password: currentPassword });
    const keyBeforeDispose = sessionKey(
      service,
      1,
      created.value.projectId,
      nodeId,
    );

    service.dispose();
    expect(keyBeforeDispose?.destroyed).toBe(true);
    expect(sessionOf(service).size).toBe(0);
    expect(service.getActiveProject(1)).toBeNull();
    expect(() => service.dispose()).not.toThrow();
  });
});
