import type {
  WorkspaceLayoutSnapshot,
  WorkspacePaneSnapshot,
  WorkspaceSplitDirection,
} from '../../../shared/contracts';

export const WORKSPACE_SPLIT_DIVIDER_SIZE = 5;
export const WORKSPACE_MIN_PANE_SIZE = 240;

export type WorkspaceSplitNode = Extract<
  WorkspaceLayoutSnapshot,
  { kind: 'split' }
>;

/**
 * A length expressed as `fraction * host size + px`, so the whole layout can be
 * flattened into absolute boxes without measuring anything.
 */
export interface WorkspaceLength {
  fraction: number;
  px: number;
}

export interface WorkspaceBox {
  height: WorkspaceLength;
  left: WorkspaceLength;
  top: WorkspaceLength;
  width: WorkspaceLength;
}

export interface WorkspaceBoxStyle {
  height: string;
  left: string;
  top: string;
  width: string;
}

export interface WorkspacePaneLayout {
  box: WorkspaceBox;
  kind: 'pane';
  left: boolean;
  node: WorkspacePaneSnapshot;
  right: boolean;
  top: boolean;
}

export interface WorkspaceDividerLayout {
  box: WorkspaceBox;
  kind: 'divider';
  node: WorkspaceSplitNode;
  region: WorkspaceBox;
}

export type WorkspaceLayoutEntry =
  | WorkspacePaneLayout
  | WorkspaceDividerLayout;

interface WorkspaceEdges {
  left: boolean;
  right: boolean;
  top: boolean;
}

function length(fraction: number, px = 0): WorkspaceLength {
  return { fraction, px };
}

function addLength(
  a: WorkspaceLength,
  b: WorkspaceLength,
): WorkspaceLength {
  return { fraction: a.fraction + b.fraction, px: a.px + b.px };
}

function scaleLength(a: WorkspaceLength, factor: number): WorkspaceLength {
  return { fraction: a.fraction * factor, px: a.px * factor };
}

function offsetLength(a: WorkspaceLength, px: number): WorkspaceLength {
  return { fraction: a.fraction, px: a.px + px };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function resolveWorkspaceLength(
  value: WorkspaceLength,
  total: number,
): number {
  return value.fraction * total + value.px;
}

export function workspaceLengthCss(value: WorkspaceLength): string {
  const fraction = round(value.fraction * 100);
  const px = round(value.px);
  if (fraction === 0) {
    return `${Math.max(0, px)}px`;
  }
  if (px === 0) {
    return `${fraction}%`;
  }
  return `calc(${fraction}% ${px < 0 ? '-' : '+'} ${Math.abs(px)}px)`;
}

export function workspaceBoxStyle(box: WorkspaceBox): WorkspaceBoxStyle {
  return {
    height: workspaceLengthCss(box.height),
    left: workspaceLengthCss(box.left),
    top: workspaceLengthCss(box.top),
    width: workspaceLengthCss(box.width),
  };
}

export function minimumWorkspaceSize(
  node: WorkspaceLayoutSnapshot,
  axis: WorkspaceSplitDirection,
): number {
  if (node.kind === 'pane') {
    return WORKSPACE_MIN_PANE_SIZE;
  }
  const first = minimumWorkspaceSize(node.first, axis);
  const second = minimumWorkspaceSize(node.second, axis);
  return node.direction === axis
    ? first + WORKSPACE_SPLIT_DIVIDER_SIZE + second
    : Math.max(first, second);
}

/**
 * Ratios that collapse every split whose branch holds only the given panes.
 * Used to place a pane at its zero-size edge, which is the frame an entering
 * pane animates out of and an exiting pane animates into.
 */
export function collapsedWorkspaceRatios(
  root: WorkspaceLayoutSnapshot,
  paneIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const ratios = new Map<string, number>();

  function visit(node: WorkspaceLayoutSnapshot): boolean {
    if (node.kind === 'pane') {
      return paneIds.has(node.paneId);
    }
    const first = visit(node.first);
    const second = visit(node.second);
    if (first && !second) {
      ratios.set(node.splitId, 0);
    } else if (second && !first) {
      ratios.set(node.splitId, 1);
    }
    return first && second;
  }

  visit(root);
  return ratios;
}

export function flattenWorkspaceLayout(
  root: WorkspaceLayoutSnapshot,
  collapsedRatios?: ReadonlyMap<string, number>,
): readonly WorkspaceLayoutEntry[] {
  const entries: WorkspaceLayoutEntry[] = [];

  function visit(
    node: WorkspaceLayoutSnapshot,
    box: WorkspaceBox,
    edges: WorkspaceEdges,
  ): void {
    if (node.kind === 'pane') {
      entries.push({ box, kind: 'pane', node, ...edges });
      return;
    }

    const ratio = collapsedRatios?.get(node.splitId) ?? node.ratio;
    const row = node.direction === 'row';
    const size = row ? box.width : box.height;
    const start = row ? box.left : box.top;
    const firstSize = scaleLength(size, ratio);
    const dividerStart = addLength(start, firstSize);
    const secondStart = offsetLength(
      dividerStart,
      WORKSPACE_SPLIT_DIVIDER_SIZE,
    );
    const secondSize = offsetLength(
      scaleLength(size, 1 - ratio),
      -WORKSPACE_SPLIT_DIVIDER_SIZE,
    );

    visit(
      node.first,
      row
        ? { ...box, width: firstSize }
        : { ...box, height: firstSize },
      {
        left: edges.left,
        right: row ? false : edges.right,
        top: edges.top,
      },
    );
    entries.push({
      box: row
        ? {
            height: box.height,
            left: dividerStart,
            top: box.top,
            width: length(0, WORKSPACE_SPLIT_DIVIDER_SIZE),
          }
        : {
            height: length(0, WORKSPACE_SPLIT_DIVIDER_SIZE),
            left: box.left,
            top: dividerStart,
            width: box.width,
          },
      kind: 'divider',
      node,
      region: box,
    });
    visit(
      node.second,
      row
        ? { ...box, left: secondStart, width: secondSize }
        : { ...box, height: secondSize, top: secondStart },
      {
        left: row ? false : edges.left,
        right: edges.right,
        top: row ? edges.top : false,
      },
    );
  }

  visit(
    root,
    {
      height: length(1),
      left: length(0),
      top: length(0),
      width: length(1),
    },
    { left: true, right: true, top: true },
  );

  return entries;
}
