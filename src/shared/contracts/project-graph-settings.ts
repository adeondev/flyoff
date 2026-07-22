export const PROJECT_GRAPH_LAYOUT_MODES = ['orbit', 'force'] as const;

export type ProjectGraphLayoutMode =
  (typeof PROJECT_GRAPH_LAYOUT_MODES)[number];

export const DEFAULT_PROJECT_GRAPH_LAYOUT_MODE: ProjectGraphLayoutMode =
  'orbit';

export interface ProjectGraphForceSettings {
  centerStrength: number;
  damping: number;
  edgeScale: number;
  labelZoom: number;
  linkParticles: number;
  nodeDistance: number;
  nodeScale: number;
  repulsion: number;
  simulationSpeed: number;
  springStrength: number;
  zoomSensitivity: number;
}

export interface ProjectGraphOrbitSettings {
  bodyScale: number;
  damping: number;
  edgeScale: number;
  elasticity: number;
  floatSpeed: number;
  floatStrength: number;
  labelZoom: number;
  spacing: number;
  zoomSensitivity: number;
}

export interface ProjectGraphSettings {
  force: ProjectGraphForceSettings;
  layoutMode: ProjectGraphLayoutMode;
  orbit: ProjectGraphOrbitSettings;
}

export const DEFAULT_PROJECT_GRAPH_FORCE_SETTINGS: Readonly<ProjectGraphForceSettings> = {
  centerStrength: 0.025,
  damping: 5.4,
  edgeScale: 1,
  labelZoom: 0.72,
  linkParticles: 1,
  nodeDistance: 112,
  nodeScale: 1,
  repulsion: 7_200,
  simulationSpeed: 1,
  springStrength: 0.055,
  zoomSensitivity: 1,
};

export const DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS: Readonly<ProjectGraphOrbitSettings> = {
  bodyScale: 1,
  damping: 0.45,
  edgeScale: 0.3,
  elasticity: 0.5,
  floatSpeed: 1.85,
  floatStrength: 2,
  labelZoom: 1.15,
  spacing: 0.95,
  zoomSensitivity: 1.3,
};

export const DEFAULT_PROJECT_GRAPH_SETTINGS: Readonly<ProjectGraphSettings> = {
  force: DEFAULT_PROJECT_GRAPH_FORCE_SETTINGS,
  layoutMode: DEFAULT_PROJECT_GRAPH_LAYOUT_MODE,
  orbit: DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS,
};

export const PROJECT_GRAPH_FORCE_SETTING_LIMITS = {
  centerStrength: { maximum: 0.08, minimum: 0, step: 0.005 },
  damping: { maximum: 12, minimum: 2, step: 0.2 },
  edgeScale: { maximum: 2, minimum: 0.5, step: 0.05 },
  labelZoom: { maximum: 1.5, minimum: 0.2, step: 0.05 },
  linkParticles: { maximum: 2, minimum: 0, step: 0.1 },
  nodeDistance: { maximum: 240, minimum: 56, step: 4 },
  nodeScale: { maximum: 1.8, minimum: 0.7, step: 0.05 },
  repulsion: { maximum: 16_000, minimum: 1_800, step: 200 },
  simulationSpeed: { maximum: 1.8, minimum: 0.35, step: 0.05 },
  springStrength: { maximum: 0.12, minimum: 0.015, step: 0.005 },
  zoomSensitivity: { maximum: 2, minimum: 0.5, step: 0.1 },
} as const satisfies Record<
  keyof ProjectGraphForceSettings,
  { maximum: number; minimum: number; step: number }
>;

export const PROJECT_GRAPH_ORBIT_SETTING_LIMITS = {
  bodyScale: { maximum: 1.8, minimum: 0.7, step: 0.05 },
  damping: { maximum: 0.95, minimum: 0.35, step: 0.05 },
  edgeScale: { maximum: 2, minimum: 0, step: 0.05 },
  elasticity: { maximum: 1.8, minimum: 0.5, step: 0.05 },
  floatSpeed: { maximum: 2, minimum: 0.25, step: 0.05 },
  floatStrength: { maximum: 2, minimum: 0, step: 0.1 },
  labelZoom: { maximum: 1.5, minimum: 0.2, step: 0.05 },
  spacing: { maximum: 1.8, minimum: 0.6, step: 0.05 },
  zoomSensitivity: { maximum: 2, minimum: 0.5, step: 0.1 },
} as const satisfies Record<
  keyof ProjectGraphOrbitSettings,
  { maximum: number; minimum: number; step: number }
>;

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function normalizeSettingsGroup<T extends Record<keyof T, number>>(
  value: unknown,
  defaults: Readonly<T>,
  limits: Record<keyof T, { maximum: number; minimum: number }>,
): T {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    (Object.keys(defaults) as Array<keyof T>).map((key) => [
      key,
      boundedNumber(
        source[String(key)],
        defaults[key],
        limits[key].minimum,
        limits[key].maximum,
      ),
    ]),
  ) as T;
}

export function normalizeProjectGraphForceSettings(
  value: unknown,
): ProjectGraphForceSettings {
  return normalizeSettingsGroup(
    value,
    DEFAULT_PROJECT_GRAPH_FORCE_SETTINGS,
    PROJECT_GRAPH_FORCE_SETTING_LIMITS,
  );
}

export function normalizeProjectGraphOrbitSettings(
  value: unknown,
): ProjectGraphOrbitSettings {
  return normalizeSettingsGroup(
    value,
    DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS,
    PROJECT_GRAPH_ORBIT_SETTING_LIMITS,
  );
}

export function normalizeProjectGraphSettings(
  value: unknown,
): ProjectGraphSettings {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    force: normalizeProjectGraphForceSettings(source.force),
    layoutMode: source.layoutMode === 'force' ? 'force' : 'orbit',
    orbit: normalizeProjectGraphOrbitSettings(source.orbit),
  };
}

export function copyProjectGraphSettings(
  settings: ProjectGraphSettings,
): ProjectGraphSettings {
  return {
    force: { ...settings.force },
    layoutMode: settings.layoutMode,
    orbit: { ...settings.orbit },
  };
}

export function resetProjectGraphModeSettings(
  settings: ProjectGraphSettings,
  mode: ProjectGraphLayoutMode,
): ProjectGraphSettings {
  const next = copyProjectGraphSettings(settings);
  if (mode === 'force') {
    next.force = { ...DEFAULT_PROJECT_GRAPH_FORCE_SETTINGS };
  } else {
    next.orbit = { ...DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS };
  }
  return next;
}

export function projectGraphSettingsEqual(
  left: ProjectGraphSettings,
  right: ProjectGraphSettings,
): boolean {
  return (
    left.layoutMode === right.layoutMode &&
    (Object.keys(DEFAULT_PROJECT_GRAPH_FORCE_SETTINGS) as Array<
      keyof ProjectGraphForceSettings
    >).every((key) => left.force[key] === right.force[key]) &&
    (Object.keys(DEFAULT_PROJECT_GRAPH_ORBIT_SETTINGS) as Array<
      keyof ProjectGraphOrbitSettings
    >).every((key) => left.orbit[key] === right.orbit[key])
  );
}
