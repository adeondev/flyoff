import { describe, expect, it } from 'vitest';

import {
  advanceMeteorCursor,
  buildProjectGraphMeteorTour,
  cubicBezierPoint,
  METEOR_MIN_SWEEP,
  orbitArcPoint,
  shortestOrbitSweep,
} from '../../src/renderer/projects/project-graph-meteor';

const edge = (sourceId: string, targetId: string) => ({
  source: { id: sourceId },
  target: { id: targetId },
});

describe('project graph meteor tours', () => {
  it('walks edges and collapses repeated planets, including the wrap', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    expect(buildProjectGraphMeteorTour([0, 1, 2], edges)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps a single edge as a two-planet round trip', () => {
    expect(buildProjectGraphMeteorTour([0], [edge('a', 'b')])).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns no tour when fewer than two distinct planets remain', () => {
    expect(buildProjectGraphMeteorTour([0], [edge('a', 'a')])).toEqual([]);
    expect(buildProjectGraphMeteorTour([], [])).toEqual([]);
  });
});

describe('project graph meteor swing', () => {
  it('lifts a shallow aim to the minimum sweep, keeping its direction', () => {
    const forward = shortestOrbitSweep(0, Math.PI / 4);
    expect(forward).toBeCloseTo(METEOR_MIN_SWEEP, 6);

    const backward = shortestOrbitSweep(0, -Math.PI / 4);
    expect(backward).toBeCloseTo(-METEOR_MIN_SWEEP, 6);
  });

  it('preserves an aim already wider than the minimum, capped at a half turn', () => {
    expect(shortestOrbitSweep(0, Math.PI * 0.8)).toBeCloseTo(Math.PI * 0.8, 6);
    // Angles past π wrap to the short side, so a 1.6π aim reads as -0.4π.
    expect(shortestOrbitSweep(0, Math.PI * 1.6)).toBeCloseTo(-METEOR_MIN_SWEEP, 6);
    expect(Math.abs(shortestOrbitSweep(0, Math.PI * 0.99))).toBeLessThanOrEqual(
      Math.PI + 1e-9,
    );
  });

  it('anchors the arc endpoints to the entry and exit angles', () => {
    const center = { x: 10, y: -4 };
    const start = orbitArcPoint(center, 6, 0, Math.PI, 0);
    const end = orbitArcPoint(center, 6, 0, Math.PI, 1);
    expect(start.x).toBeCloseTo(16, 6);
    expect(start.y).toBeCloseTo(-4, 6);
    expect(end.x).toBeCloseTo(4, 6);
    expect(end.y).toBeCloseTo(-4, 6);
  });
});

describe('project graph meteor transfer', () => {
  it('interpolates between the endpoints of the cubic', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: 10 };
    const p2 = { x: 10, y: 10 };
    const p3 = { x: 10, y: 0 };
    expect(cubicBezierPoint(p0, p1, p2, p3, 0)).toEqual(p0);
    expect(cubicBezierPoint(p0, p1, p2, p3, 1)).toEqual(p3);
    const mid = cubicBezierPoint(p0, p1, p2, p3, 0.5);
    expect(mid.x).toBeCloseTo(5, 6);
    expect(mid.y).toBeGreaterThan(0);
  });
});

describe('project graph meteor cursor', () => {
  const lengths = [10, 10, 10, 10];

  it('advances within a segment as normalized progress', () => {
    expect(advanceMeteorCursor({ segIndex: 0, t: 0 }, 5, lengths)).toEqual({
      segIndex: 0,
      t: 0.5,
    });
  });

  it('carries overshoot into the next segment', () => {
    expect(advanceMeteorCursor({ segIndex: 0, t: 0 }, 15, lengths)).toEqual({
      segIndex: 1,
      t: 0.5,
    });
  });

  it('resumes from the stored progress, not the segment start', () => {
    expect(advanceMeteorCursor({ segIndex: 2, t: 0.5 }, 5, lengths)).toEqual({
      segIndex: 3,
      t: 0,
    });
  });

  it('wraps around the end of the cycle', () => {
    expect(advanceMeteorCursor({ segIndex: 0, t: 0 }, 45, lengths)).toEqual({
      segIndex: 0,
      t: 0.5,
    });
  });

  it('never loops forever on empty or zero-length cycles', () => {
    expect(advanceMeteorCursor({ segIndex: 0, t: 0 }, 5, [])).toEqual({
      segIndex: 0,
      t: 0,
    });
    expect(advanceMeteorCursor({ segIndex: 1, t: 0.3 }, 5, [0, 0])).toEqual({
      segIndex: 1,
      t: 0,
    });
  });
});
