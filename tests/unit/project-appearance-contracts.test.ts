import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  emptyProjectAppearanceSnapshot,
  isAppearanceSeed,
  isProjectAppearanceSnapshot,
  isSetProjectAppearanceRequest,
  isSetProjectNoteAppearanceRequest,
  normalizeAppearanceSeed,
} from '../../src/shared/contracts';

const nodeId = randomUUID();

describe('appearance seeds', () => {
  it('accepts six-digit hex colours in either case', () => {
    expect(isAppearanceSeed('#8F4FC4')).toBe(true);
    expect(isAppearanceSeed('#8f4fc4')).toBe(true);
  });

  it('rejects shorthand, named, and functional colours', () => {
    for (const value of [
      '#fff',
      '#8F4FC4FF',
      'red',
      'rgb(0 0 0)',
      'var(--color-accent)',
      '8F4FC4',
      '',
      null,
      42,
    ]) {
      expect(isAppearanceSeed(value)).toBe(false);
    }
  });

  it('normalizes to uppercase and drops unusable values', () => {
    expect(normalizeAppearanceSeed('#8f4fc4')).toBe('#8F4FC4');
    expect(normalizeAppearanceSeed('nope')).toBeNull();
    expect(normalizeAppearanceSeed(undefined)).toBeNull();
  });
});

describe('isProjectAppearanceSnapshot', () => {
  it('accepts the empty snapshot', () => {
    expect(isProjectAppearanceSnapshot(emptyProjectAppearanceSnapshot())).toBe(
      true,
    );
  });

  it('accepts populated seed maps', () => {
    expect(
      isProjectAppearanceSnapshot({
        projectSeed: '#8F4FC4',
        noteSeeds: { [nodeId]: '#3568A4' },
      }),
    ).toBe(true);
  });

  it('rejects unknown keys, bad identifiers, and bad seeds', () => {
    expect(
      isProjectAppearanceSnapshot({
        projectSeed: null,
        noteSeeds: {},
        extra: 1,
      }),
    ).toBe(false);
    expect(
      isProjectAppearanceSnapshot({
        projectSeed: null,
        noteSeeds: { 'not-a-uuid': '#3568A4' },
      }),
    ).toBe(false);
    expect(
      isProjectAppearanceSnapshot({
        projectSeed: null,
        noteSeeds: { [nodeId]: 'red' },
      }),
    ).toBe(false);
    expect(isProjectAppearanceSnapshot({ projectSeed: null })).toBe(false);
  });
});

describe('appearance requests', () => {
  it('accepts a seed or an explicit clear', () => {
    expect(
      isSetProjectNoteAppearanceRequest({ nodeId, seed: '#8F4FC4' }),
    ).toBe(true);
    expect(isSetProjectNoteAppearanceRequest({ nodeId, seed: null })).toBe(
      true,
    );
    expect(isSetProjectAppearanceRequest({ seed: '#8F4FC4' })).toBe(true);
    expect(isSetProjectAppearanceRequest({ seed: null })).toBe(true);
  });

  it('rejects malformed requests', () => {
    expect(
      isSetProjectNoteAppearanceRequest({ nodeId: 'nope', seed: '#8F4FC4' }),
    ).toBe(false);
    expect(isSetProjectNoteAppearanceRequest({ nodeId })).toBe(false);
    expect(
      isSetProjectNoteAppearanceRequest({ nodeId, seed: '#8F4FC4', extra: 1 }),
    ).toBe(false);
    expect(isSetProjectAppearanceRequest({ seed: 'red' })).toBe(false);
    expect(isSetProjectAppearanceRequest(null)).toBe(false);
  });
});
