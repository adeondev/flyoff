export interface ProjectGraphMeteorPoint {
  x: number;
  y: number;
}

// A meteor's position along its cyclic tour is stored as which segment it is on
// and a normalized progress `t` (0..1) into that segment. Storing normalized
// progress — rather than an absolute world distance — keeps motion stable when
// the planets move and segment lengths are recomputed each frame: a changed
// length only alters how fast `t` advances, it never makes the rendered point
// jump (which an absolute-distance ÷ current-length ratio would).
export interface ProjectGraphMeteorCursor {
  segIndex: number;
  t: number;
}

// A tour is a partial swing around each planet, so the sweep stays near a half
// turn: enough to read as "curving around the planet" without doubling back.
// The exit-vs-entry angle is normalized to (-π, π], so the sweep magnitude
// naturally caps at a half turn; this only lifts near-collinear hops off zero.
export const METEOR_MIN_SWEEP = Math.PI * 0.55;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeSignedAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let value = angle % twoPi;
  if (value <= -Math.PI) {
    value += twoPi;
  } else if (value > Math.PI) {
    value -= twoPi;
  }
  return value;
}

// Turns a system's edges into the ordered list of planet ids a meteor visits.
// Edges are walked in order (source, target, source, target, …) and collapsed so
// the meteor never lingers on the same planet twice in a row, including across
// the wrap back to the start. Fewer than two distinct planets means no tour.
export function buildProjectGraphMeteorTour(
  edgeIndices: readonly number[],
  edges: readonly { source: { id: string }; target: { id: string } }[],
): string[] {
  const tour: string[] = [];
  const push = (id: string) => {
    if (tour[tour.length - 1] !== id) {
      tour.push(id);
    }
  };
  for (const edgeIndex of edgeIndices) {
    const edge = edges[edgeIndex];
    if (!edge) {
      continue;
    }
    push(edge.source.id);
    push(edge.target.id);
  }
  while (tour.length > 1 && tour[0] === tour[tour.length - 1]) {
    tour.pop();
  }
  return tour.length < 2 ? [] : tour;
}

// Signed angle the meteor sweeps around a planet, entering from the side facing
// where it came from and leaving toward where it is going, clamped to a gentle
// half-turn so even near-collinear hops still visibly wrap the planet.
export function shortestOrbitSweep(
  entryAngle: number,
  exitAngle: number,
): number {
  const delta = normalizeSignedAngle(exitAngle - entryAngle);
  const sign = delta < 0 ? -1 : 1;
  return sign * Math.max(METEOR_MIN_SWEEP, Math.abs(delta));
}

// Point on the arc a meteor traces around a planet, from `entryAngle` at t=0 to
// `entryAngle + sweep` at t=1.
export function orbitArcPoint(
  center: ProjectGraphMeteorPoint,
  radius: number,
  entryAngle: number,
  sweep: number,
  t: number,
): ProjectGraphMeteorPoint {
  const angle = entryAngle + sweep * clamp01(t);
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

// Standard cubic Bézier evaluation. Used for the transfer between planets, with
// control handles laid along the arc tangents so the swing stays continuous.
export function cubicBezierPoint(
  p0: ProjectGraphMeteorPoint,
  p1: ProjectGraphMeteorPoint,
  p2: ProjectGraphMeteorPoint,
  p3: ProjectGraphMeteorPoint,
  t: number,
): ProjectGraphMeteorPoint {
  const u = clamp01(t);
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

// Advances a cursor by `distance` world units across a cyclic list of segment
// lengths, carrying any overshoot into the following segment and wrapping at the
// end. Progress is tracked as normalized `t` per segment: the current segment's
// length only sets the *rate* `t` advances, so a length that changes between
// frames never causes the rendered point to jump. Constant `distance` per unit
// time therefore yields constant world speed.
export function advanceMeteorCursor(
  cursor: ProjectGraphMeteorCursor,
  distance: number,
  segmentLengths: readonly number[],
): ProjectGraphMeteorCursor {
  const count = segmentLengths.length;
  if (count === 0) {
    return { segIndex: 0, t: 0 };
  }
  let segIndex = ((cursor.segIndex % count) + count) % count;
  let t = clamp01(cursor.t);
  const total = segmentLengths.reduce((sum, length) => sum + Math.max(0, length), 0);
  if (total <= 0) {
    return { segIndex, t: 0 };
  }
  let remaining = Math.max(0, distance);
  let guard = count * 4 + 8;
  while (remaining > 0 && guard > 0) {
    guard -= 1;
    // Epsilon floor keeps division safe and lets ~zero-length segments be
    // stepped past instead of trapping the cursor.
    const segLength = Math.max(1e-6, segmentLengths[segIndex] ?? 0);
    const room = (1 - t) * segLength;
    if (remaining < room) {
      t += remaining / segLength;
      break;
    }
    remaining -= room;
    segIndex = (segIndex + 1) % count;
    t = 0;
  }
  return { segIndex, t };
}
