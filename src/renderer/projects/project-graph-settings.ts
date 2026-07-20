export interface ProjectGraphSettings {
  centerStrength: number;
  damping: number;
  edgeScale: number;
  labelZoom: number;
  nodeDistance: number;
  nodeScale: number;
  repulsion: number;
  simulationSpeed: number;
  springStrength: number;
  zoomSensitivity: number;
}

export const DEFAULT_PROJECT_GRAPH_SETTINGS: Readonly<ProjectGraphSettings> = {
  centerStrength: 0.025,
  damping: 5.4,
  edgeScale: 1,
  labelZoom: 0.72,
  nodeDistance: 112,
  nodeScale: 1,
  repulsion: 7_200,
  simulationSpeed: 1,
  springStrength: 0.055,
  zoomSensitivity: 1,
};

export const PROJECT_GRAPH_SETTING_LIMITS = {
  centerStrength: { maximum: 0.08, minimum: 0, step: 0.005 },
  damping: { maximum: 12, minimum: 2, step: 0.2 },
  edgeScale: { maximum: 2, minimum: 0.5, step: 0.05 },
  labelZoom: { maximum: 1.5, minimum: 0.2, step: 0.05 },
  nodeDistance: { maximum: 240, minimum: 56, step: 4 },
  nodeScale: { maximum: 1.8, minimum: 0.7, step: 0.05 },
  repulsion: { maximum: 16_000, minimum: 1_800, step: 200 },
  simulationSpeed: { maximum: 1.8, minimum: 0.35, step: 0.05 },
  springStrength: { maximum: 0.12, minimum: 0.015, step: 0.005 },
  zoomSensitivity: { maximum: 2, minimum: 0.5, step: 0.1 },
} as const satisfies Record<
  keyof ProjectGraphSettings,
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

export function normalizeProjectGraphSettings(
  value: unknown,
): ProjectGraphSettings {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_PROJECT_GRAPH_SETTINGS).map(([key, fallback]) => {
      const setting = key as keyof ProjectGraphSettings;
      const limits = PROJECT_GRAPH_SETTING_LIMITS[setting];
      return [
        setting,
        boundedNumber(
          source[setting],
          fallback,
          limits.minimum,
          limits.maximum,
        ),
      ];
    }),
  ) as unknown as ProjectGraphSettings;
}

export function projectGraphSettingsEqual(
  left: ProjectGraphSettings,
  right: ProjectGraphSettings,
): boolean {
  return (
    Object.keys(DEFAULT_PROJECT_GRAPH_SETTINGS) as Array<
      keyof ProjectGraphSettings
    >
  ).every((key) => left[key] === right[key]);
}
