import type { ProjectGraphSnapshot } from '../../shared/contracts';

// A "solar system" layout: every folder becomes a sun, notes orbit the sun of
// their folder, and subfolders become smaller suns orbiting their parent. The
// hierarchy is derived entirely from each node's project-relative `path`, so no
// backend/contract changes are required.

export type ProjectGraphOrbitKind = 'note' | 'sun';

export interface ProjectGraphOrbitBody {
  angularSpeed: number;
  baseAngle: number;
  childSunIds: readonly string[];
  connectionCount: number;
  depth: number;
  id: string;
  kind: ProjectGraphOrbitKind;
  memberNoteIds: readonly string[];
  name: string;
  noteCount: number;
  orbitRadius: number;
  parentId: string | null;
  path: string;
  radius: number;
  // Resolved world position, filled by positionProjectGraphOrbit.
  x: number;
  y: number;
}

export interface ProjectGraphOrbitEdge {
  source: ProjectGraphOrbitBody;
  target: ProjectGraphOrbitBody;
  weight: number;
}

export interface ProjectGraphOrbitSystem {
  edgeIndices: readonly number[];
  sun: ProjectGraphOrbitBody;
}

export interface ProjectGraphOrbitLayout {
  bodies: readonly ProjectGraphOrbitBody[];
  byId: ReadonlyMap<string, ProjectGraphOrbitBody>;
  edges: readonly ProjectGraphOrbitEdge[];
  notes: readonly ProjectGraphOrbitBody[];
  rootId: string | null;
  suns: readonly ProjectGraphOrbitBody[];
  systems: readonly ProjectGraphOrbitSystem[];
}

export interface ProjectGraphOrbitOptions {
  rootName?: string;
}

const SUN_BASE_RADIUS = 9;
const SUN_RADIUS_PER_NOTE = 3.4;
const SUN_MAX_RADIUS = 46;
const NOTE_BASE_RADIUS = 3.6;
const NOTE_RADIUS_PER_LINK = 0.55;
const NOTE_MAX_RADIUS = 8;
const NOTE_GAP = 26;
const SUN_GAP = 40;
const RING_MARGIN = 16;
// A gentle orbital pace: inner notes finish a lap in roughly half a minute.
const ORBIT_SPEED_BASE = 2.6;
const SUN_SPEED_FACTOR = 0.35;

const ROOT_ID = 'sun:';

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function unitAngle(value: string): number {
  return (hashString(value) / 0xffff_ffff) * Math.PI * 2;
}

function segments(path: string): string[] {
  return path
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sunId(folderPath: string): string {
  return `sun:${folderPath}`;
}

function noteRadius(connectionCount: number): number {
  return Math.min(
    NOTE_MAX_RADIUS,
    NOTE_BASE_RADIUS + Math.sqrt(Math.max(0, connectionCount)) * NOTE_RADIUS_PER_LINK,
  );
}

function sunRadius(noteCount: number): number {
  return Math.min(
    SUN_MAX_RADIUS,
    SUN_BASE_RADIUS + Math.sqrt(Math.max(0, noteCount)) * SUN_RADIUS_PER_NOTE,
  );
}

// Smallest ring radius that keeps `count` bodies of the given footprint from
// overlapping when spread evenly around the ring.
function ringRadiusFor(
  count: number,
  footprint: number,
  minimum: number,
): number {
  if (count <= 0) {
    return minimum;
  }
  if (count === 1) {
    return Math.max(minimum, footprint + RING_MARGIN);
  }
  const packed = (count * (footprint * 2 + RING_MARGIN)) / (Math.PI * 2);
  return Math.max(minimum, packed);
}

interface MutableSun {
  body: ProjectGraphOrbitBody;
  childSuns: MutableSun[];
  footprint: number;
  memberNotes: ProjectGraphOrbitBody[];
}

export function buildProjectGraphOrbit(
  snapshot: ProjectGraphSnapshot,
  options: ProjectGraphOrbitOptions = {},
): ProjectGraphOrbitLayout {
  const byId = new Map<string, ProjectGraphOrbitBody>();
  const sunsByPath = new Map<string, MutableSun>();
  const notes: ProjectGraphOrbitBody[] = [];

  if (snapshot.nodes.length === 0) {
    return {
      bodies: [],
      byId,
      edges: [],
      notes: [],
      rootId: null,
      suns: [],
      systems: [],
    };
  }

  function ensureSun(folderPath: string): MutableSun {
    const existing = sunsByPath.get(folderPath);
    if (existing) {
      return existing;
    }
    const parts = segments(folderPath);
    const depth = parts.length;
    const isRoot = depth === 0;
    const name = isRoot
      ? options.rootName ?? 'Projeto'
      : parts[parts.length - 1]!;
    const body: ProjectGraphOrbitBody = {
      angularSpeed: 0,
      baseAngle: 0,
      childSunIds: [],
      connectionCount: 0,
      depth,
      id: isRoot ? ROOT_ID : sunId(folderPath),
      kind: 'sun',
      memberNoteIds: [],
      name,
      noteCount: 0,
      orbitRadius: 0,
      parentId: null,
      path: folderPath,
      radius: SUN_BASE_RADIUS,
      x: 0,
      y: 0,
    };
    const sun: MutableSun = {
      body,
      childSuns: [],
      footprint: SUN_BASE_RADIUS,
      memberNotes: [],
    };
    sunsByPath.set(folderPath, sun);
    byId.set(body.id, body);

    if (!isRoot) {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = ensureSun(parentPath);
      body.parentId = parent.body.id;
      parent.childSuns.push(sun);
    }
    return sun;
  }

  // Always anchor everything to a synthetic root sun (the project itself).
  const root = ensureSun('');

  for (const node of snapshot.nodes) {
    const parts = segments(node.path);
    const folderPath = parts.slice(0, -1).join('/');
    const parent = ensureSun(folderPath);
    const body: ProjectGraphOrbitBody = {
      angularSpeed: 0,
      baseAngle: 0,
      childSunIds: [],
      connectionCount: node.connectionCount,
      depth: parent.body.depth + 1,
      id: node.nodeId,
      kind: 'note',
      memberNoteIds: [],
      name: node.name,
      noteCount: 0,
      orbitRadius: 0,
      parentId: parent.body.id,
      path: node.path,
      radius: noteRadius(node.connectionCount),
      x: 0,
      y: 0,
    };
    parent.memberNotes.push(body);
    notes.push(body);
    byId.set(body.id, body);
  }

  // Post-order: sizes and footprints from the leaves up.
  function measure(sun: MutableSun): void {
    for (const child of sun.childSuns) {
      measure(child);
    }
    const descendantNotes =
      sun.memberNotes.length +
      sun.childSuns.reduce((total, child) => total + child.body.noteCount, 0);
    sun.body.noteCount = descendantNotes;
    sun.body.radius = sunRadius(descendantNotes);

    const noteFootprint = sun.memberNotes.reduce(
      (max, note) => Math.max(max, note.radius),
      NOTE_BASE_RADIUS,
    );
    const notesRing = ringRadiusFor(
      sun.memberNotes.length,
      noteFootprint,
      sun.body.radius + NOTE_GAP,
    );
    const notesOuter =
      sun.memberNotes.length > 0 ? notesRing + noteFootprint : sun.body.radius;

    const childFootprint = sun.childSuns.reduce(
      (max, child) => Math.max(max, child.footprint),
      0,
    );
    const sunsMinimum = notesOuter + childFootprint + SUN_GAP;
    const sunsRing =
      sun.childSuns.length > 0
        ? ringRadiusFor(sun.childSuns.length, childFootprint, sunsMinimum)
        : 0;

    // Assign orbit radii and stable base angles now that rings are known.
    const noteOffset = unitAngle(`${sun.body.id}:notes`);
    sun.memberNotes.forEach((note, index) => {
      note.orbitRadius = notesRing;
      note.baseAngle =
        noteOffset + (index / Math.max(1, sun.memberNotes.length)) * Math.PI * 2;
      note.angularSpeed = orbitSpeed(notesRing, 'note');
    });

    const sunOffset = unitAngle(`${sun.body.id}:suns`);
    sun.childSuns.forEach((child, index) => {
      child.body.orbitRadius = sunsRing;
      child.body.baseAngle =
        sunOffset + (index / Math.max(1, sun.childSuns.length)) * Math.PI * 2;
      child.body.angularSpeed = orbitSpeed(sunsRing, 'sun');
    });

    sun.body = {
      ...sun.body,
      childSunIds: sun.childSuns.map((child) => child.body.id),
      memberNoteIds: sun.memberNotes.map((note) => note.id),
    };
    byId.set(sun.body.id, sun.body);

    const outer = Math.max(notesOuter, sunsRing + childFootprint);
    sun.footprint = outer + RING_MARGIN;
  }
  measure(root);

  // Resolve edges against note bodies and index systems that carry links.
  const edges: ProjectGraphOrbitEdge[] = [];
  for (const edge of snapshot.edges) {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);
    if (source && target && source.kind === 'note' && target.kind === 'note') {
      edges.push({ source, target, weight: edge.weight });
    }
  }

  const systemEdges = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    for (const parentId of new Set([
      edge.source.parentId,
      edge.target.parentId,
    ])) {
      if (!parentId) {
        continue;
      }
      const list = systemEdges.get(parentId);
      if (list) {
        list.push(index);
      } else {
        systemEdges.set(parentId, [index]);
      }
    }
  });

  const suns = [...sunsByPath.values()].map((sun) => sun.body);
  const systems: ProjectGraphOrbitSystem[] = [];
  for (const [parentId, edgeIndices] of systemEdges) {
    const sun = byId.get(parentId);
    if (sun && sun.kind === 'sun') {
      systems.push({ edgeIndices, sun });
    }
  }
  systems.sort((left, right) => left.sun.id.localeCompare(right.sun.id));

  const bodies = [...byId.values()].sort(
    (left, right) => left.depth - right.depth,
  );

  return { bodies, byId, edges, notes, rootId: ROOT_ID, suns, systems };
}

function orbitSpeed(orbitRadius: number, kind: ProjectGraphOrbitKind): number {
  if (orbitRadius <= 0) {
    return 0;
  }
  const speed = ORBIT_SPEED_BASE / Math.sqrt(orbitRadius);
  return kind === 'sun' ? speed * SUN_SPEED_FACTOR : speed;
}

// Resolves every body's world position at a moment in time. Parents are
// positioned before their children (bodies are depth-sorted), so nested suns
// orbit their already-placed parent. Pass `frozen` for reduced motion.
export function positionProjectGraphOrbit(
  layout: ProjectGraphOrbitLayout,
  timeSeconds: number,
  frozen = false,
): void {
  const time = frozen ? 0 : timeSeconds;
  for (const body of layout.bodies) {
    if (body.parentId === null) {
      body.x = 0;
      body.y = 0;
      continue;
    }
    const parent = layout.byId.get(body.parentId);
    const centerX = parent?.x ?? 0;
    const centerY = parent?.y ?? 0;
    const angle = body.baseAngle + time * body.angularSpeed;
    body.x = centerX + Math.cos(angle) * body.orbitRadius;
    body.y = centerY + Math.sin(angle) * body.orbitRadius;
  }
}
