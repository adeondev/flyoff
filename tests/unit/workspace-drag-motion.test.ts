import { describe, expect, it } from 'vitest';

import { workspaceTabFlightGeometry } from '../../src/renderer/components/tabs/workspace-drag-motion';

describe('workspace drag motion', () => {
  const source = { height: 40, left: 120, top: 8, width: 176 };
  const pane = { height: 700, left: 50, top: 0, width: 1_000 };

  it('lands a tab in the new right pane header', () => {
    const result = workspaceTabFlightGeometry(source, pane, 'right');
    expect(result.x).toBeGreaterThan(400);
    expect(result.y).toBe(-4);
    expect(result.scaleX).toBe(1);
    expect(result.scaleY).toBe(1);
  });

  it('lands a tab at the header of a new bottom pane', () => {
    const result = workspaceTabFlightGeometry(source, pane, 'bottom');
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeGreaterThan(300);
    expect(result.scaleX).toBe(1);
  });
});
