import type {
  ProjectGraphNode,
  ProjectGraphSnapshot,
} from '../../shared/contracts';
import type { ProjectGraphSettings } from './project-graph-settings';

export interface ProjectGraphLayoutNode extends ProjectGraphNode {
  pinned: boolean;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

export interface ProjectGraphLayoutEdge {
  source: ProjectGraphLayoutNode;
  target: ProjectGraphLayoutNode;
  weight: number;
}

export interface ProjectGraphLayout {
  edges: readonly ProjectGraphLayoutEdge[];
  nodes: readonly ProjectGraphLayoutNode[];
}

export interface ProjectGraphCamera {
  targetX: number;
  targetY: number;
  targetZoom: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
  zoom: number;
}

export interface ProjectGraphPoint {
  x: number;
  y: number;
}

export const PROJECT_GRAPH_MIN_ZOOM = 0.18;
export const PROJECT_GRAPH_MAX_ZOOM = 6;

function nodeHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function clampProjectGraphZoom(value: number): number {
  return Math.min(
    PROJECT_GRAPH_MAX_ZOOM,
    Math.max(PROJECT_GRAPH_MIN_ZOOM, value),
  );
}

export function createProjectGraphLayout(
  snapshot: ProjectGraphSnapshot,
  previous?: readonly ProjectGraphLayoutNode[],
): ProjectGraphLayout {
  const previousById = new Map(
    previous?.map((node) => [node.nodeId, node]),
  );
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const nodes = snapshot.nodes.map((node, index) => {
    const existing = previousById.get(node.nodeId);
    if (existing) {
      return {
        ...node,
        pinned: false,
        vx: existing.vx,
        vy: existing.vy,
        x: existing.x,
        y: existing.y,
      };
    }
    const hash = nodeHash(node.nodeId);
    const angle =
      index * goldenAngle + (hash / 0xffff_ffff) * Math.PI * 2;
    const radius = 28 + Math.sqrt(index + 1) * 44;
    return {
      ...node,
      pinned: false,
      vx: 0,
      vy: 0,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges = snapshot.edges.flatMap((edge) => {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    return source && target ? [{ ...edge, source, target }] : [];
  });
  return { edges, nodes };
}

export function stepProjectGraphLayout(
  layout: ProjectGraphLayout,
  elapsedSeconds: number,
  settings: ProjectGraphSettings,
): number {
  const delta = Math.min(
    0.05,
    Math.max(0.001, elapsedSeconds * settings.simulationSpeed),
  );
  const forces = new Map<
    ProjectGraphLayoutNode,
    { x: number; y: number }
  >();
  const cellSize = Math.max(90, settings.nodeDistance * 1.35);
  const cells = new Map<string, ProjectGraphLayoutNode[]>();

  for (const node of layout.nodes) {
    forces.set(node, {
      x: -node.x * settings.centerStrength,
      y: -node.y * settings.centerStrength,
    });
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const key = `${cellX}:${cellY}`;
    const cell = cells.get(key);
    if (cell) {
      cell.push(node);
    } else {
      cells.set(key, [node]);
    }
  }

  for (const node of layout.nodes) {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const neighbors = cells.get(
          `${cellX + offsetX}:${cellY + offsetY}`,
        );
        if (!neighbors) {
          continue;
        }
        for (const neighbor of neighbors) {
          if (neighbor === node || neighbor.nodeId <= node.nodeId) {
            continue;
          }
          let dx = neighbor.x - node.x;
          let dy = neighbor.y - node.y;
          let distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < 0.01) {
            const angle =
              (nodeHash(`${node.nodeId}:${neighbor.nodeId}`) /
                0xffff_ffff) *
              Math.PI *
              2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distanceSquared = 1;
          }
          if (distanceSquared > cellSize * cellSize * 2.25) {
            continue;
          }
          const distance = Math.sqrt(distanceSquared);
          const strength = settings.repulsion / (distanceSquared + 80);
          const forceX = (dx / distance) * strength;
          const forceY = (dy / distance) * strength;
          const nodeForce = forces.get(node)!;
          const neighborForce = forces.get(neighbor)!;
          nodeForce.x -= forceX;
          nodeForce.y -= forceY;
          neighborForce.x += forceX;
          neighborForce.y += forceY;
        }
      }
    }
  }

  for (const edge of layout.edges) {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const restLength =
      settings.nodeDistance -
      Math.min(
        settings.nodeDistance * 0.196,
        Math.log2(edge.weight + 1) * (settings.nodeDistance / 14),
      );
    const strength =
      (distance - restLength) *
      (settings.springStrength + Math.min(edge.weight, 5) * 0.008);
    const forceX = (dx / distance) * strength;
    const forceY = (dy / distance) * strength;
    const sourceForce = forces.get(edge.source)!;
    const targetForce = forces.get(edge.target)!;
    sourceForce.x += forceX;
    sourceForce.y += forceY;
    targetForce.x -= forceX;
    targetForce.y -= forceY;
  }

  const damping = Math.exp(-settings.damping * delta);
  let energy = 0;
  for (const node of layout.nodes) {
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    const force = forces.get(node)!;
    node.vx = (node.vx + force.x * delta * 48) * damping;
    node.vy = (node.vy + force.y * delta * 48) * damping;
    const speed = Math.hypot(node.vx, node.vy);
    const maximumSpeed = 720 * Math.max(1, settings.simulationSpeed);
    if (speed > maximumSpeed) {
      node.vx = (node.vx / speed) * maximumSpeed;
      node.vy = (node.vy / speed) * maximumSpeed;
    }
    node.x += node.vx * delta;
    node.y += node.vy * delta;
    energy += node.vx * node.vx + node.vy * node.vy;
  }
  return layout.nodes.length === 0 ? 0 : energy / layout.nodes.length;
}

export function fitProjectGraphCamera(
  nodes: readonly Pick<ProjectGraphLayoutNode, 'x' | 'y'>[],
  width: number,
  height: number,
  padding = 46,
): Pick<ProjectGraphCamera, 'targetX' | 'targetY' | 'targetZoom'> {
  if (nodes.length === 0) {
    return { targetX: 0, targetY: 0, targetZoom: 1 };
  }
  const xs = nodes.map(({ x }) => x);
  const ys = nodes.map(({ y }) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const contentWidth = Math.max(48, maximumX - minimumX + 36);
  const contentHeight = Math.max(48, maximumY - minimumY + 36);
  return {
    targetX: (minimumX + maximumX) / 2,
    targetY: (minimumY + maximumY) / 2,
    targetZoom: clampProjectGraphZoom(
      Math.min(
        Math.max(1, width - padding * 2) / contentWidth,
        Math.max(1, height - padding * 2) / contentHeight,
        1.45,
      ),
    ),
  };
}

export function projectGraphScreenToWorld(
  point: ProjectGraphPoint,
  camera: Pick<ProjectGraphCamera, 'x' | 'y' | 'zoom'>,
  width: number,
  height: number,
): ProjectGraphPoint {
  return {
    x: camera.x + (point.x - width / 2) / camera.zoom,
    y: camera.y + (point.y - height / 2) / camera.zoom,
  };
}

export function projectGraphWorldToScreen(
  point: ProjectGraphPoint,
  camera: Pick<ProjectGraphCamera, 'x' | 'y' | 'zoom'>,
  width: number,
  height: number,
): ProjectGraphPoint {
  return {
    x: (point.x - camera.x) * camera.zoom + width / 2,
    y: (point.y - camera.y) * camera.zoom + height / 2,
  };
}
