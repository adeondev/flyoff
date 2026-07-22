import { describe, expect, it } from 'vitest';

import {
  beginProjectGraphOrbitDrag,
  createProjectGraphOrbitMotion,
  endProjectGraphOrbitDrag,
  getProjectGraphOrbitPosition,
  hasProjectGraphOrbitMotion,
  moveProjectGraphOrbitBody,
  stepProjectGraphOrbitMotion,
  updateProjectGraphOrbitPositions,
} from '../../src/renderer/projects/project-graph-orbit-motion';
import {
  buildProjectGraphOrbit,
  positionProjectGraphOrbit,
} from '../../src/renderer/projects/project-graph-orbit';
import { DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS } from '../../src/renderer/projects/project-graph-settings';
import type { ProjectGraphSnapshot } from '../../src/shared/contracts';

const NOTE_A = '11111111-1111-4111-8111-111111111111';
const NOTE_SUB = '22222222-2222-4222-8222-222222222222';
const MOTION_SETTINGS = {
  ...DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS,
  damping: 0.72,
  elasticity: 1,
  floatSpeed: 1,
  floatStrength: 1,
  spacing: 1,
};

const snapshot: ProjectGraphSnapshot = {
  edges: [],
  nodes: [
    { connectionCount: 0, name: 'A', nodeId: NOTE_A, path: 'Folder/A' },
    {
      connectionCount: 0,
      name: 'Sub',
      nodeId: NOTE_SUB,
      path: 'Folder/Sub/Sub',
    },
  ],
};

function setup() {
  const orbit = buildProjectGraphOrbit(snapshot);
  positionProjectGraphOrbit(orbit);
  const motion = createProjectGraphOrbitMotion(orbit);
  return { motion, orbit };
}

describe('project graph orbit motion', () => {
  it('moves a note directly and resets it immediately', () => {
    const { motion, orbit } = setup();
    const note = orbit.byId.get(NOTE_A)!;

    beginProjectGraphOrbitDrag(motion, note.id);
    moveProjectGraphOrbitBody(motion, note.id, 28, -16);
    updateProjectGraphOrbitPositions(
      motion,
      0,
      MOTION_SETTINGS,
      false,
      1,
    );
    expect(getProjectGraphOrbitPosition(motion, note)).toEqual({
      x: note.x + 28,
      y: note.y - 16,
    });

    endProjectGraphOrbitDrag(motion, note.id, true);
    updateProjectGraphOrbitPositions(
      motion,
      0,
      MOTION_SETTINGS,
      false,
      1,
    );
    expect(getProjectGraphOrbitPosition(motion, note)).toEqual({
      x: note.x,
      y: note.y,
    });
  });

  it('moves every descendant with a dragged sun', () => {
    const { motion, orbit } = setup();
    const sun = orbit.byId.get('sun:Folder')!;
    const childSun = orbit.byId.get('sun:Folder/Sub')!;
    const note = orbit.byId.get(NOTE_SUB)!;

    beginProjectGraphOrbitDrag(motion, sun.id);
    moveProjectGraphOrbitBody(motion, sun.id, -35, 22);
    updateProjectGraphOrbitPositions(
      motion,
      0,
      MOTION_SETTINGS,
      false,
      1,
    );

    for (const body of [sun, childSun, note]) {
      expect(getProjectGraphOrbitPosition(motion, body)).toEqual({
        x: body.x - 35,
        y: body.y + 22,
      });
    }
  });

  it('applies configured spacing and disables floating at zero intensity', () => {
    const { motion, orbit } = setup();
    const note = orbit.byId.get(NOTE_A)!;
    const settings = {
      ...MOTION_SETTINGS,
      floatStrength: 0,
      spacing: 1.5,
    };

    updateProjectGraphOrbitPositions(motion, 18, settings, true, 1);
    expect(getProjectGraphOrbitPosition(motion, note)).toEqual({
      x: note.x * 1.5,
      y: note.y * 1.5,
    });
  });

  it('uses elasticity and damping to control the return', () => {
    const slow = setup();
    const fast = setup();
    const slowNote = slow.orbit.byId.get(NOTE_A)!;
    const fastNote = fast.orbit.byId.get(NOTE_A)!;
    for (const [motion, note] of [
      [slow.motion, slowNote],
      [fast.motion, fastNote],
    ] as const) {
      beginProjectGraphOrbitDrag(motion, note.id);
      moveProjectGraphOrbitBody(motion, note.id, 100, 0);
      endProjectGraphOrbitDrag(motion, note.id, false);
    }
    const slowSettings = {
      ...MOTION_SETTINGS,
      damping: 0.4,
      elasticity: 0.5,
    };
    const fastSettings = {
      ...MOTION_SETTINGS,
      damping: 0.9,
      elasticity: 1.8,
    };
    for (let frame = 0; frame < 10; frame += 1) {
      stepProjectGraphOrbitMotion(slow.motion, 1 / 120, slowSettings);
      stepProjectGraphOrbitMotion(fast.motion, 1 / 120, fastSettings);
    }
    updateProjectGraphOrbitPositions(slow.motion, 0, slowSettings, false, 1);
    updateProjectGraphOrbitPositions(fast.motion, 0, fastSettings, false, 1);

    expect(
      Math.abs(getProjectGraphOrbitPosition(fast.motion, fastNote).x - fastNote.x),
    ).toBeLessThan(
      Math.abs(getProjectGraphOrbitPosition(slow.motion, slowNote).x - slowNote.x),
    );
  });

  it('returns with a soft spring and goes idle', () => {
    const { motion, orbit } = setup();
    const note = orbit.byId.get(NOTE_A)!;

    beginProjectGraphOrbitDrag(motion, note.id);
    moveProjectGraphOrbitBody(motion, note.id, 120, -40);
    endProjectGraphOrbitDrag(motion, note.id, false);

    for (let frame = 0; frame < 15; frame += 1) {
      stepProjectGraphOrbitMotion(
        motion,
        1 / 120,
        MOTION_SETTINGS,
      );
    }
    updateProjectGraphOrbitPositions(
      motion,
      0,
      MOTION_SETTINGS,
      false,
      1,
    );
    const settling = getProjectGraphOrbitPosition(motion, note);
    expect(settling.x - note.x).toBeGreaterThan(0);
    expect(settling.x - note.x).toBeLessThan(30);

    for (let frame = 0; frame < 15; frame += 1) {
      stepProjectGraphOrbitMotion(
        motion,
        1 / 120,
        MOTION_SETTINGS,
      );
    }
    updateProjectGraphOrbitPositions(
      motion,
      0,
      MOTION_SETTINGS,
      false,
      1,
    );
    expect(getProjectGraphOrbitPosition(motion, note).x - note.x).toBeLessThan(0);

    for (let frame = 0; frame < 120; frame += 1) {
      stepProjectGraphOrbitMotion(
        motion,
        1 / 120,
        MOTION_SETTINGS,
      );
    }
    updateProjectGraphOrbitPositions(
      motion,
      0,
      MOTION_SETTINGS,
      false,
      1,
    );
    expect(hasProjectGraphOrbitMotion(motion)).toBe(false);
    expect(getProjectGraphOrbitPosition(motion, note)).toEqual({
      x: note.x,
      y: note.y,
    });
  });

  it('keeps floating deterministic and skips bodies outside the viewport', () => {
    const { motion, orbit } = setup();
    const note = orbit.byId.get(NOTE_A)!;
    const viewport = {
      maximumX: note.x + 10,
      maximumY: note.y + 10,
      minimumX: note.x - 10,
      minimumY: note.y - 10,
    };

    updateProjectGraphOrbitPositions(
      motion,
      12.5,
      MOTION_SETTINGS,
      true,
      1,
      viewport,
    );
    const first = { ...getProjectGraphOrbitPosition(motion, note) };
    updateProjectGraphOrbitPositions(
      motion,
      12.5,
      MOTION_SETTINGS,
      true,
      1,
      viewport,
    );
    expect(getProjectGraphOrbitPosition(motion, note)).toEqual(first);

    updateProjectGraphOrbitPositions(
      motion,
      12.5,
      MOTION_SETTINGS,
      true,
      1,
      {
        maximumX: note.x + 200,
        maximumY: note.y + 200,
        minimumX: note.x + 100,
        minimumY: note.y + 100,
      },
    );
    expect(getProjectGraphOrbitPosition(motion, note)).toEqual({
      x: note.x,
      y: note.y,
    });
  });
});
