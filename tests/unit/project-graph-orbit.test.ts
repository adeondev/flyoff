import { describe, expect, it } from 'vitest';

import {
  buildProjectGraphOrbit,
  positionProjectGraphOrbit,
} from '../../src/renderer/projects/project-graph-orbit';
import type { ProjectGraphSnapshot } from '../../src/shared/contracts';

const NOTE_1 = '11111111-1111-4111-8111-111111111111';
const NOTE_2 = '22222222-2222-4222-8222-222222222222';
const NOTE_3 = '33333333-3333-4333-8333-333333333333';
const ROOT_NOTE = '44444444-4444-4444-8444-444444444444';

const snapshot: ProjectGraphSnapshot = {
  nodes: [
    { connectionCount: 2, name: 'Nota 1', nodeId: NOTE_1, path: 'A/Nota 1' },
    { connectionCount: 1, name: 'Nota 2', nodeId: NOTE_2, path: 'A/Nota 2' },
    { connectionCount: 1, name: 'Nota 3', nodeId: NOTE_3, path: 'A/Sub/Nota 3' },
    { connectionCount: 0, name: 'Início', nodeId: ROOT_NOTE, path: 'Início' },
  ],
  edges: [
    { sourceNodeId: NOTE_1, targetNodeId: NOTE_2, weight: 2 },
    { sourceNodeId: NOTE_1, targetNodeId: NOTE_3, weight: 1 },
  ],
};

describe('project graph orbit layout', () => {
  it('derives a folder hierarchy of suns from note paths', () => {
    const orbit = buildProjectGraphOrbit(snapshot, { rootName: 'Projeto' });

    expect(orbit.rootId).toBe('sun:');
    const root = orbit.byId.get('sun:');
    const sunA = orbit.byId.get('sun:A');
    const sunSub = orbit.byId.get('sun:A/Sub');
    expect(root?.name).toBe('Projeto');
    expect(sunA?.kind).toBe('sun');
    expect(sunSub?.kind).toBe('sun');

    // Root contains the top-level folder and the root-level note.
    expect(root?.childSunIds).toContain('sun:A');
    expect(root?.memberNoteIds).toContain(ROOT_NOTE);
    // Folder A contains its two notes and the nested sub-folder.
    expect(sunA?.memberNoteIds).toEqual([NOTE_1, NOTE_2]);
    expect(sunA?.childSunIds).toEqual(['sun:A/Sub']);
    expect(sunSub?.memberNoteIds).toEqual([NOTE_3]);

    // Descendant note counts drive sun size.
    expect(root?.noteCount).toBe(4);
    expect(sunA?.noteCount).toBe(3);
    expect(sunSub?.noteCount).toBe(1);
    expect(sunA!.radius).toBeGreaterThan(sunSub!.radius);
  });

  it('indexes only the systems that carry connections', () => {
    const orbit = buildProjectGraphOrbit(snapshot);
    const systemIds = orbit.systems.map((system) => system.sun.id).sort();
    expect(systemIds).toEqual(['sun:A', 'sun:A/Sub']);
    const systemA = orbit.systems.find((system) => system.sun.id === 'sun:A');
    // A carries both the intra-folder edge and the cross-folder edge.
    expect(systemA?.edgeIndices.length).toBe(2);
  });

  it('positions the root and its children deterministically', () => {
    const orbit = buildProjectGraphOrbit(snapshot);
    positionProjectGraphOrbit(orbit);
    const root = orbit.byId.get('sun:')!;
    const note1 = orbit.byId.get(NOTE_1)!;
    const firstX = note1.x;
    const firstY = note1.y;
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);
    expect(Math.hypot(note1.x, note1.y)).toBeGreaterThan(0);

    // Repositioning keeps the stable layout unchanged.
    positionProjectGraphOrbit(orbit);
    expect(note1.x).toBe(firstX);
    expect(note1.y).toBe(firstY);
  });

  it('returns an empty layout for an empty graph', () => {
    const orbit = buildProjectGraphOrbit({ edges: [], nodes: [] });
    expect(orbit.bodies).toHaveLength(0);
    expect(orbit.rootId).toBeNull();
    expect(orbit.systems).toHaveLength(0);
  });
});
