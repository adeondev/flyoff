import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  isProjectNoteActivityEntry,
  isProjectNoteActivityEntryList,
  isProjectNoteActivityEvent,
} from '../../src/shared/contracts';

describe('project note activity contracts', () => {
  it('validates exact activity entries and lists', () => {
    const entry = {
      projectId: randomUUID(),
      nodeId: randomUUID(),
      activationCount: 2,
      lastActivatedAt: '2026-07-19T12:00:00.000Z',
      lastClosedAt: null,
    };

    expect(isProjectNoteActivityEntry(entry)).toBe(true);
    expect(isProjectNoteActivityEntryList([entry])).toBe(true);
    expect(isProjectNoteActivityEntry({ ...entry, extra: true })).toBe(false);
    expect(
      isProjectNoteActivityEntry({ ...entry, activationCount: -1 }),
    ).toBe(false);
    expect(
      isProjectNoteActivityEntry({
        ...entry,
        activationCount: 0,
        lastActivatedAt: entry.lastActivatedAt,
      }),
    ).toBe(false);
    expect(isProjectNoteActivityEntryList([entry, entry])).toBe(false);
  });

  it('accepts only bounded renderer events without timestamps or project ids', () => {
    const event = { type: 'activated' as const, nodeId: randomUUID() };
    expect(isProjectNoteActivityEvent(event)).toBe(true);
    expect(isProjectNoteActivityEvent({ ...event, type: 'closed' })).toBe(true);
    expect(
      isProjectNoteActivityEvent({
        ...event,
        projectId: randomUUID(),
      }),
    ).toBe(false);
    expect(
      isProjectNoteActivityEvent({
        ...event,
        lastActivatedAt: '2026-07-19T12:00:00.000Z',
      }),
    ).toBe(false);
    expect(isProjectNoteActivityEvent({ ...event, nodeId: 'invalid' })).toBe(
      false,
    );
  });
});
