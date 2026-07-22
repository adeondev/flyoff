import { describe, expect, it } from 'vitest';

import {
  copyProjectGraphSettings,
  DEFAULT_PROJECT_GRAPH_SETTINGS,
  normalizeProjectGraphSettings,
  PROJECT_GRAPH_FORCE_SETTING_LIMITS,
  PROJECT_GRAPH_ORBIT_SETTING_LIMITS,
  resetProjectGraphModeSettings,
} from '../../src/shared/contracts';

describe('project graph preferences', () => {
  it('uses the tuned Orbit defaults', () => {
    expect(DEFAULT_PROJECT_GRAPH_SETTINGS).toEqual({
      force: expect.any(Object),
      layoutMode: 'orbit',
      orbit: {
        bodyScale: 1,
        damping: 0.45,
        edgeScale: 0.3,
        elasticity: 0.5,
        floatSpeed: 1.85,
        floatStrength: 2,
        labelZoom: 1.15,
        spacing: 0.95,
        zoomSensitivity: 1.3,
      },
    });
  });

  it('normalizes both modes and rejects an unknown layout mode', () => {
    const settings = normalizeProjectGraphSettings({
      force: {
        nodeDistance: 180,
        repulsion: -50,
        springStrength: 'invalid',
      },
      layoutMode: 'unknown',
      orbit: {
        damping: 20,
        floatStrength: -3,
        spacing: 1.5,
      },
    });

    expect(settings.layoutMode).toBe('orbit');
    expect(settings.force.nodeDistance).toBe(180);
    expect(settings.force.repulsion).toBe(
      PROJECT_GRAPH_FORCE_SETTING_LIMITS.repulsion.minimum,
    );
    expect(settings.force.springStrength).toBe(
      DEFAULT_PROJECT_GRAPH_SETTINGS.force.springStrength,
    );
    expect(settings.orbit.damping).toBe(
      PROJECT_GRAPH_ORBIT_SETTING_LIMITS.damping.maximum,
    );
    expect(settings.orbit.floatStrength).toBe(0);
    expect(settings.orbit.spacing).toBe(1.5);
  });

  it('restores only the settings for the active mode', () => {
    const settings = copyProjectGraphSettings(DEFAULT_PROJECT_GRAPH_SETTINGS);
    settings.force.nodeDistance = 200;
    settings.orbit.spacing = 1.6;

    const resetOrbit = resetProjectGraphModeSettings(settings, 'orbit');
    expect(resetOrbit.force.nodeDistance).toBe(200);
    expect(resetOrbit.orbit).toEqual(DEFAULT_PROJECT_GRAPH_SETTINGS.orbit);
    expect(resetOrbit.layoutMode).toBe('orbit');

    const resetForce = resetProjectGraphModeSettings(settings, 'force');
    expect(resetForce.force).toEqual(DEFAULT_PROJECT_GRAPH_SETTINGS.force);
    expect(resetForce.orbit.spacing).toBe(1.6);
  });
});
