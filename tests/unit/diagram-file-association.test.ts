import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  completePendingDiagramOpen,
  pendingDiagramOpenCount,
  peekPendingDiagramOpen,
  queuePendingDiagramOpen,
} from '../../src/main/diagrams/pending-diagram-open';

afterEach(() => {
  const pending = peekPendingDiagramOpen();
  if (pending) {
    completePendingDiagramOpen(pending);
  }
});

describe('Flyoff Diagram File association', () => {
  it('queues only absolute .flyd paths and deduplicates repeated OS events', () => {
    const filePath = path.resolve('Architecture.flyd');
    expect(queuePendingDiagramOpen(filePath)).toBe(true);
    expect(queuePendingDiagramOpen(filePath.toUpperCase())).toBe(true);
    expect(queuePendingDiagramOpen('relative.flyd')).toBe(false);
    expect(queuePendingDiagramOpen(path.resolve('model.asta'))).toBe(false);
    expect(pendingDiagramOpenCount()).toBe(process.platform === 'win32' ? 1 : 2);
    expect(peekPendingDiagramOpen()).toBe(path.normalize(filePath));
  });

  it('declares the requested extension, MIME type and Flyoff icon resources', () => {
    const forge = readFileSync(path.join(process.cwd(), 'forge.config.ts'), 'utf8');
    const mime = readFileSync(
      path.join(
        process.cwd(),
        'resources/mime/application-vnd.flyoff.diagram.xml',
      ),
      'utf8',
    );
    expect(forge).toContain("CFBundleTypeExtensions: ['flyd']");
    expect(forge).toContain("UTTypeIdentifier: 'com.flyoff.diagram'");
    expect(forge).toContain("'public.mime-type': 'application/vnd.flyoff.diagram'");
    expect(forge).toContain("setupIcon: './resources/icons/flyoff.ico'");
    expect(mime).toContain('type="application/vnd.flyoff.diagram"');
    expect(mime).toContain('pattern="*.flyd"');
  });
});
