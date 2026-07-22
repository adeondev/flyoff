import type {
  ProjectGraphOrbitBody,
  ProjectGraphOrbitLayout,
} from './project-graph-orbit';
import type { ProjectGraphOrbitSettings } from './project-graph-settings';

export interface ProjectGraphOrbitMotionViewport {
  maximumX: number;
  maximumY: number;
  minimumX: number;
  minimumY: number;
}

interface ProjectGraphOrbitMotionState {
  dragging: boolean;
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
}

interface ProjectGraphOrbitPosition {
  x: number;
  y: number;
}

export interface ProjectGraphOrbitMotion {
  readonly bodyIndices: ReadonlyMap<string, number>;
  readonly layout: ProjectGraphOrbitLayout;
  readonly positions: readonly ProjectGraphOrbitPosition[];
  readonly states: Map<string, ProjectGraphOrbitMotionState>;
  readonly floatPhaseX: Float64Array;
  readonly floatPhaseY: Float64Array;
  readonly floatSpeedX: Float64Array;
  readonly floatSpeedY: Float64Array;
  readonly parentIndices: Int32Array;
  readonly resolvedOffsetX: Float64Array;
  readonly resolvedOffsetY: Float64Array;
}

const POSITION_EPSILON = 0.04;
const VELOCITY_EPSILON = 0.3;

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function hashUnit(value: string): number {
  return hashString(value) / 0xffff_ffff;
}

export function createProjectGraphOrbitMotion(
  layout: ProjectGraphOrbitLayout,
): ProjectGraphOrbitMotion {
  const bodyIndices = new Map(
    layout.bodies.map((body, index) => [body.id, index]),
  );
  const count = layout.bodies.length;
  const parentIndices = new Int32Array(count);
  const positions = layout.bodies.map(({ x, y }) => ({ x, y }));
  const floatPhaseX = new Float64Array(count);
  const floatPhaseY = new Float64Array(count);
  const floatSpeedX = new Float64Array(count);
  const floatSpeedY = new Float64Array(count);

  layout.bodies.forEach((body, index) => {
    parentIndices[index] = body.parentId === null
      ? -1
      : (bodyIndices.get(body.parentId) ?? -1);
    floatPhaseX[index] = hashUnit(`${body.id}:float-x`) * Math.PI * 2;
    floatPhaseY[index] = hashUnit(`${body.id}:float-y`) * Math.PI * 2;
    floatSpeedX[index] = 0.72 + hashUnit(`${body.id}:speed-x`) * 0.24;
    floatSpeedY[index] = 0.58 + hashUnit(`${body.id}:speed-y`) * 0.2;
  });

  return {
    bodyIndices,
    floatPhaseX,
    floatPhaseY,
    floatSpeedX,
    floatSpeedY,
    layout,
    parentIndices,
    positions,
    resolvedOffsetX: new Float64Array(count),
    resolvedOffsetY: new Float64Array(count),
    states: new Map(),
  };
}

export function getProjectGraphOrbitPosition(
  motion: ProjectGraphOrbitMotion,
  body: ProjectGraphOrbitBody,
): ProjectGraphOrbitPosition {
  const index = motion.bodyIndices.get(body.id);
  return index === undefined ? body : motion.positions[index]!;
}

export function beginProjectGraphOrbitDrag(
  motion: ProjectGraphOrbitMotion,
  bodyId: string,
): void {
  const state = motion.states.get(bodyId) ?? {
    dragging: true,
    offsetX: 0,
    offsetY: 0,
    velocityX: 0,
    velocityY: 0,
  };
  state.dragging = true;
  state.velocityX = 0;
  state.velocityY = 0;
  motion.states.set(bodyId, state);
}

export function moveProjectGraphOrbitBody(
  motion: ProjectGraphOrbitMotion,
  bodyId: string,
  deltaX: number,
  deltaY: number,
): void {
  const state = motion.states.get(bodyId);
  if (!state?.dragging) {
    return;
  }
  state.offsetX += deltaX;
  state.offsetY += deltaY;
}

export function endProjectGraphOrbitDrag(
  motion: ProjectGraphOrbitMotion,
  bodyId: string,
  immediate: boolean,
): void {
  const state = motion.states.get(bodyId);
  if (!state) {
    return;
  }
  if (immediate) {
    motion.states.delete(bodyId);
    return;
  }
  state.dragging = false;
  state.velocityX = 0;
  state.velocityY = 0;
}

export function stepProjectGraphOrbitMotion(
  motion: ProjectGraphOrbitMotion,
  elapsedSeconds: number,
  settings: ProjectGraphOrbitSettings,
): boolean {
  const delta = Math.min(0.05, Math.max(0.001, elapsedSeconds));
  const returnFrequency = 18 * settings.elasticity;
  const damping = returnFrequency * settings.damping;
  const dampedFrequency =
    returnFrequency * Math.sqrt(1 - settings.damping ** 2);
  const decay = Math.exp(-damping * delta);
  const sine = Math.sin(dampedFrequency * delta);
  const cosine = Math.cos(dampedFrequency * delta);
  const positionFromVelocity = sine / dampedFrequency;
  const positionFromPosition =
    cosine + (damping / dampedFrequency) * sine;
  const velocityFromVelocity =
    cosine - (damping / dampedFrequency) * sine;
  const velocityFromPosition =
    -(returnFrequency ** 2 / dampedFrequency) * sine;

  for (const [bodyId, state] of motion.states) {
    if (state.dragging) {
      continue;
    }
    const offsetX = state.offsetX;
    const offsetY = state.offsetY;
    state.offsetX =
      (offsetX * positionFromPosition +
        state.velocityX * positionFromVelocity) *
      decay;
    state.offsetY =
      (offsetY * positionFromPosition +
        state.velocityY * positionFromVelocity) *
      decay;
    state.velocityX =
      (offsetX * velocityFromPosition +
        state.velocityX * velocityFromVelocity) *
      decay;
    state.velocityY =
      (offsetY * velocityFromPosition +
        state.velocityY * velocityFromVelocity) *
      decay;

    if (
      Math.abs(state.offsetX) < POSITION_EPSILON &&
      Math.abs(state.offsetY) < POSITION_EPSILON &&
      Math.abs(state.velocityX) < VELOCITY_EPSILON &&
      Math.abs(state.velocityY) < VELOCITY_EPSILON
    ) {
      motion.states.delete(bodyId);
    }
  }

  return motion.states.size > 0;
}

export function hasProjectGraphOrbitMotion(
  motion: ProjectGraphOrbitMotion,
): boolean {
  return motion.states.size > 0;
}

export function updateProjectGraphOrbitPositions(
  motion: ProjectGraphOrbitMotion,
  timeSeconds: number,
  settings: ProjectGraphOrbitSettings,
  floatEnabled: boolean,
  zoom: number,
  viewport?: ProjectGraphOrbitMotionViewport,
): void {
  const amplitudeScale = 1 / Math.max(0.18, zoom);

  motion.layout.bodies.forEach((body, index) => {
    const parentIndex = motion.parentIndices[index]!;
    const state = motion.states.get(body.id);
    const inheritedX = parentIndex < 0 ? 0 : motion.resolvedOffsetX[parentIndex]!;
    const inheritedY = parentIndex < 0 ? 0 : motion.resolvedOffsetY[parentIndex]!;
    const offsetX = inheritedX + (state?.offsetX ?? 0);
    const offsetY = inheritedY + (state?.offsetY ?? 0);
    motion.resolvedOffsetX[index] = offsetX;
    motion.resolvedOffsetY[index] = offsetY;

    const baseX = body.x * settings.spacing + offsetX;
    const baseY = body.y * settings.spacing + offsetY;
    const visible =
      viewport === undefined ||
      (baseX >= viewport.minimumX &&
        baseX <= viewport.maximumX &&
        baseY >= viewport.minimumY &&
        baseY <= viewport.maximumY);
    const floating = floatEnabled && visible && !state?.dragging;
    const amplitude =
      (body.kind === 'sun' ? 0.7 : 1.05) *
      amplitudeScale *
      settings.floatStrength;
    const position = motion.positions[index]!;
    position.x = baseX + (floating
      ? Math.sin(
          timeSeconds * settings.floatSpeed * motion.floatSpeedX[index]! +
            motion.floatPhaseX[index]!,
        ) *
        amplitude
      : 0);
    position.y = baseY + (floating
      ? Math.sin(
          timeSeconds * settings.floatSpeed * motion.floatSpeedY[index]! +
            motion.floatPhaseY[index]!,
        ) *
        amplitude
      : 0);
  });
}
