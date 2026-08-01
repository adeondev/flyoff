export type ChromiumTraceInput =
  | string
  | readonly unknown[]
  | Readonly<Record<string, unknown>>;

export interface ChromiumTraceAnalysisOptions {
  refreshIntervalMs: number;
}

export interface ChromiumTraceProcess {
  isRenderer: boolean;
  name: string;
  pid: number;
}

export type ChromiumTraceMarkerSource =
  | 'performance-mark'
  | 'timestamp';

export interface ChromiumTraceMarkerSourceCounts {
  ends: number;
  starts: number;
}

export interface ChromiumTraceMarkerSummary {
  endSource: ChromiumTraceMarkerSource | null;
  endTimestampsUs: readonly number[];
  label: string;
  pairedIntervals: number;
  sources: {
    performanceMark: ChromiumTraceMarkerSourceCounts;
    timeStamp: ChromiumTraceMarkerSourceCounts;
  };
  startSource: ChromiumTraceMarkerSource | null;
  startTimestampsUs: readonly number[];
  unmatchedEnds: number;
  unmatchedStarts: number;
}

export interface ChromiumTraceRefreshBucket {
  intervals: number;
  multiple: number;
  targetMs: number;
}

export interface ChromiumTraceFrameDistribution {
  beyondFourRefreshes: number;
  intervalCount: number;
  maximumMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  refreshBuckets: readonly ChromiumTraceRefreshBucket[];
}

export interface ChromiumTraceFrameSeries {
  duplicateTimestamps: number;
  eventCount: number;
  intervalsMs: readonly number[];
  timing: ChromiumTraceFrameDistribution;
  timestampsUs: readonly number[];
}

export interface ChromiumTracePipelineReporterSummary {
  events: number;
  flags: {
    checkerboard: number;
    highLatency: number;
    missingContent: number;
  };
  states: {
    dropped: number;
    other: number;
    presented: number;
  };
}

export interface ChromiumTraceDurationSummary {
  eventCount: number;
  totalDurationMs: number;
}

export interface ChromiumTraceRenderingSummary {
  compositorViz: ChromiumTraceDurationSummary;
  paintPrepaint: ChromiumTraceDurationSummary;
  raster: ChromiumTraceDurationSummary;
  styleLayout: ChromiumTraceDurationSummary;
}

export interface ChromiumTraceRendererLongTasks {
  count: number;
  maximumDurationMs: number | null;
  pid: number;
  processName: string;
  totalDurationMs: number;
}

export interface ChromiumTraceScenarioAnalysis {
  durationMs: number;
  endTimestampUs: number;
  frames: {
    displayed: ChromiumTraceFrameSeries;
    presented: ChromiumTraceFrameSeries;
  };
  label: string;
  occurrence: number;
  pipelineReporter: ChromiumTracePipelineReporterSummary;
  rendererLongTasks: readonly ChromiumTraceRendererLongTasks[];
  rendering: ChromiumTraceRenderingSummary;
  startTimestampUs: number;
}

export interface ChromiumTraceAnalysis {
  markerEvents: number;
  markers: readonly ChromiumTraceMarkerSummary[];
  processes: readonly ChromiumTraceProcess[];
  refreshIntervalMs: number;
  scenarios: readonly ChromiumTraceScenarioAnalysis[];
  traceEvents: number;
}

type TraceEvent = Readonly<Record<string, unknown>>;
type MarkerEdge = 'end' | 'start';
type RenderingCategory = keyof ChromiumTraceRenderingSummary;

interface MarkerCandidates {
  performanceMark: Record<MarkerEdge, number[]>;
  timeStamp: Record<MarkerEdge, number[]>;
}

interface ScenarioInterval {
  endTimestampUs: number;
  label: string;
  occurrence: number;
  startTimestampUs: number;
}

interface DurationInterval {
  end: number;
  start: number;
}

const MARKER_PATTERN = /^flyoff-diagnostic:(.+):(start|end)$/;
const RENDERING_CATEGORIES: readonly RenderingCategory[] = [
  'styleLayout',
  'paintPrepaint',
  'raster',
  'compositorViz',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseTraceEvents(input: ChromiumTraceInput): TraceEvent[] {
  const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  const events = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? parsed.traceEvents
      : null;

  if (!Array.isArray(events)) {
    throw new TypeError('Chromium trace input must contain a traceEvents array.');
  }

  return events.filter(isRecord);
}

function processName(event: TraceEvent): string | null {
  if (event.name !== 'process_name' || event.ph !== 'M') {
    return null;
  }

  const args = event.args;
  if (!isRecord(args)) {
    return null;
  }
  if (typeof args.name === 'string') {
    return args.name;
  }

  const data = args.data;
  return isRecord(data) && typeof data.name === 'string' ? data.name : null;
}

function collectProcesses(events: readonly TraceEvent[]): ChromiumTraceProcess[] {
  const names = new Map<number, string>();

  for (const event of events) {
    const pid = finiteNumber(event.pid);
    const name = processName(event);
    if (pid !== null && name !== null) {
      names.set(pid, name);
    }
  }

  return [...names]
    .map(([pid, name]) => ({
      isRenderer: /(?:^|\W)renderer(?:\W|$)/i.test(name),
      name,
      pid,
    }))
    .sort((left, right) => left.pid - right.pid);
}

function markerFromEvent(
  event: TraceEvent,
): { edge: MarkerEdge; label: string; source: ChromiumTraceMarkerSource } | null {
  const ownName = typeof event.name === 'string' ? event.name : null;
  let marker = ownName;
  let source: ChromiumTraceMarkerSource = 'performance-mark';

  if (ownName === 'TimeStamp') {
    const args = event.args;
    const data = isRecord(args) ? args.data : null;
    marker = isRecord(data) && typeof data.message === 'string'
      ? data.message
      : null;
    source = 'timestamp';
  }

  const match = marker?.match(MARKER_PATTERN);
  const label = match?.[1];
  const edge = match?.[2];
  if (!label || (edge !== 'start' && edge !== 'end')) {
    return null;
  }

  return { edge, label, source };
}

function emptyMarkerCandidates(): MarkerCandidates {
  return {
    performanceMark: { end: [], start: [] },
    timeStamp: { end: [], start: [] },
  };
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function selectedMarkerEdge(
  candidates: MarkerCandidates,
  edge: MarkerEdge,
): { source: ChromiumTraceMarkerSource | null; timestamps: number[] } {
  if (candidates.performanceMark[edge].length > 0) {
    return {
      source: 'performance-mark',
      timestamps: uniqueSorted(candidates.performanceMark[edge]),
    };
  }
  if (candidates.timeStamp[edge].length > 0) {
    return {
      source: 'timestamp',
      timestamps: uniqueSorted(candidates.timeStamp[edge]),
    };
  }
  return { source: null, timestamps: [] };
}

function pairMarkerTimestamps(
  label: string,
  starts: readonly number[],
  ends: readonly number[],
): {
  intervals: ScenarioInterval[];
  unmatchedEnds: number;
  unmatchedStarts: number;
} {
  const intervals: ScenarioInterval[] = [];
  let endIndex = 0;
  let unmatchedEnds = 0;
  let unmatchedStarts = 0;

  for (const startTimestampUs of starts) {
    while ((ends[endIndex] ?? Number.POSITIVE_INFINITY) < startTimestampUs) {
      unmatchedEnds += 1;
      endIndex += 1;
    }

    const endTimestampUs = ends[endIndex];
    if (endTimestampUs === undefined) {
      unmatchedStarts += 1;
      continue;
    }

    intervals.push({
      endTimestampUs,
      label,
      occurrence: intervals.length + 1,
      startTimestampUs,
    });
    endIndex += 1;
  }

  unmatchedEnds += ends.length - endIndex;
  return { intervals, unmatchedEnds, unmatchedStarts };
}

function collectMarkers(events: readonly TraceEvent[]): {
  markerEvents: number;
  markers: ChromiumTraceMarkerSummary[];
  scenarios: ScenarioInterval[];
} {
  const groups = new Map<string, MarkerCandidates>();
  let markerEvents = 0;

  for (const event of events) {
    const timestamp = finiteNumber(event.ts);
    const marker = markerFromEvent(event);
    if (timestamp === null || marker === null) {
      continue;
    }

    markerEvents += 1;
    const group = groups.get(marker.label) ?? emptyMarkerCandidates();
    group[marker.source === 'timestamp' ? 'timeStamp' : 'performanceMark'][
      marker.edge
    ].push(timestamp);
    groups.set(marker.label, group);
  }

  const markers: ChromiumTraceMarkerSummary[] = [];
  const scenarios: ScenarioInterval[] = [];

  for (const [label, candidates] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const starts = selectedMarkerEdge(candidates, 'start');
    const ends = selectedMarkerEdge(candidates, 'end');
    const paired = pairMarkerTimestamps(label, starts.timestamps, ends.timestamps);
    scenarios.push(...paired.intervals);
    markers.push({
      endSource: ends.source,
      endTimestampsUs: ends.timestamps,
      label,
      pairedIntervals: paired.intervals.length,
      sources: {
        performanceMark: {
          ends: candidates.performanceMark.end.length,
          starts: candidates.performanceMark.start.length,
        },
        timeStamp: {
          ends: candidates.timeStamp.end.length,
          starts: candidates.timeStamp.start.length,
        },
      },
      startSource: starts.source,
      startTimestampsUs: starts.timestamps,
      unmatchedEnds: paired.unmatchedEnds,
      unmatchedStarts: paired.unmatchedStarts,
    });
  }

  scenarios.sort(
    (left, right) =>
      left.startTimestampUs - right.startTimestampUs ||
      left.label.localeCompare(right.label),
  );
  return { markerEvents, markers, scenarios };
}

function roundMilliseconds(value: number): number {
  return Number(value.toFixed(2));
}

function percentile(sorted: readonly number[], share: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * share))
  ] ?? null;
}

function frameDistribution(
  intervalsMs: readonly number[],
  refreshIntervalMs: number,
): ChromiumTraceFrameDistribution {
  const sorted = [...intervalsMs].sort((left, right) => left - right);
  const tolerance = refreshIntervalMs / 2;
  const value = (share: number): number | null => {
    const result = percentile(sorted, share);
    return result === null ? null : roundMilliseconds(result);
  };

  return {
    beyondFourRefreshes: sorted.filter(
      (interval) => interval > refreshIntervalMs * 4 + tolerance,
    ).length,
    intervalCount: sorted.length,
    maximumMs:
      sorted.length === 0
        ? null
        : roundMilliseconds(sorted[sorted.length - 1] ?? 0),
    medianMs: value(0.5),
    p95Ms: value(0.95),
    p99Ms: value(0.99),
    refreshBuckets: [1, 2, 3, 4].map((multiple) => ({
      intervals: sorted.filter(
        (interval) =>
          Math.abs(interval - refreshIntervalMs * multiple) <= tolerance,
      ).length,
      multiple,
      targetMs: roundMilliseconds(refreshIntervalMs * multiple),
    })),
  };
}

function frameSeries(
  events: readonly TraceEvent[],
  name: 'Display::FrameDisplayed' | 'FramePresented',
  scenario: ScenarioInterval,
  refreshIntervalMs: number,
): ChromiumTraceFrameSeries {
  const rawTimestamps = events.flatMap((event) => {
    const timestamp = finiteNumber(event.ts);
    return event.name === name &&
      timestamp !== null &&
      timestamp >= scenario.startTimestampUs &&
      timestamp <= scenario.endTimestampUs
      ? [timestamp]
      : [];
  });
  const timestampsUs = uniqueSorted(rawTimestamps);
  const intervalsMs = timestampsUs.slice(1).map((timestamp, index) =>
    roundMilliseconds((timestamp - (timestampsUs[index] ?? timestamp)) / 1_000),
  );

  return {
    duplicateTimestamps: rawTimestamps.length - timestampsUs.length,
    eventCount: rawTimestamps.length,
    intervalsMs,
    timing: frameDistribution(intervalsMs, refreshIntervalMs),
    timestampsUs,
  };
}

function visitArgumentEntries(
  value: unknown,
  visitor: (key: string, value: unknown) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitArgumentEntries(item, visitor);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    visitor(key.toLowerCase(), entryValue);
    visitArgumentEntries(entryValue, visitor);
  }
}

function pipelineReporterSummary(
  events: readonly TraceEvent[],
  scenario: ScenarioInterval,
): ChromiumTracePipelineReporterSummary {
  const summary: ChromiumTracePipelineReporterSummary = {
    events: 0,
    flags: { checkerboard: 0, highLatency: 0, missingContent: 0 },
    states: { dropped: 0, other: 0, presented: 0 },
  };

  for (const event of events) {
    const timestamp = finiteNumber(event.ts);
    if (
      event.name !== 'PipelineReporter' ||
      timestamp === null ||
      timestamp < scenario.startTimestampUs ||
      timestamp > scenario.endTimestampUs
    ) {
      continue;
    }

    let checkerboard = false;
    let highLatency = false;
    let missingContent = false;
    const states: string[] = [];
    let hasPayload = false;
    visitArgumentEntries(event.args, (key, value) => {
      if (key === 'state' && typeof value === 'string') {
        states.push(value);
        hasPayload = true;
      }
      if (value !== true) {
        return;
      }
      if (key.includes('checkerboard')) {
        checkerboard = true;
        hasPayload = true;
      }
      if (key.includes('missing')) {
        missingContent = true;
        hasPayload = true;
      }
      if (key.includes('high_latency')) {
        highLatency = true;
        hasPayload = true;
      }
    });
    if (!hasPayload) {
      continue;
    }

    summary.events += 1;
    const state = states.at(-1);
    if (state?.startsWith('STATE_DROPPED')) {
      summary.states.dropped += 1;
    } else if (state?.startsWith('STATE_PRESENTED')) {
      summary.states.presented += 1;
    } else {
      summary.states.other += 1;
    }
    summary.flags.checkerboard += Number(checkerboard);
    summary.flags.highLatency += Number(highLatency);
    summary.flags.missingContent += Number(missingContent);
  }

  return summary;
}

function renderingCategory(event: TraceEvent): RenderingCategory | null {
  const name = typeof event.name === 'string' ? event.name.toLowerCase() : '';
  const category = typeof event.cat === 'string' ? event.cat.toLowerCase() : '';

  if (name.includes('raster')) {
    return 'raster';
  }
  if (name.includes('style') || name.includes('layout')) {
    return 'styleLayout';
  }
  if (
    name.includes('prepaint') ||
    name === 'paint' ||
    name.startsWith('paint') ||
    name.includes('::paint') ||
    name.includes('.paint') ||
    name.includes('runpaint')
  ) {
    return 'paintPrepaint';
  }

  const traceCategories = category.split(',').map((value) => value.trim());
  if (
    traceCategories.some(
      (value) =>
        value === 'cc' ||
        value === 'viz' ||
        value.startsWith('cc.') ||
        value.startsWith('viz.'),
    ) ||
    /compositor|viz::|graphics\.pipeline|drawandswap|drawframe|beginframe|submitcompositorframe|presentationcompositorframe/.test(
      name,
    )
  ) {
    return 'compositorViz';
  }

  return null;
}

function mergedDuration(intervals: readonly DurationInterval[]): number {
  const sorted = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let duration = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;

  for (const interval of sorted) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      duration += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }

  return duration + (currentStart === null ? 0 : currentEnd - currentStart);
}

function renderingSummary(
  events: readonly TraceEvent[],
  scenario: ScenarioInterval,
): ChromiumTraceRenderingSummary {
  const counts: Record<RenderingCategory, number> = {
    compositorViz: 0,
    paintPrepaint: 0,
    raster: 0,
    styleLayout: 0,
  };
  const intervals = new Map<RenderingCategory, Map<string, DurationInterval[]>>(
    RENDERING_CATEGORIES.map((category) => [category, new Map()]),
  );

  events.forEach((event, index) => {
    const timestamp = finiteNumber(event.ts);
    const duration = finiteNumber(event.dur);
    const category = renderingCategory(event);
    if (timestamp === null || duration === null || duration <= 0 || category === null) {
      return;
    }

    const start = Math.max(timestamp, scenario.startTimestampUs);
    const end = Math.min(timestamp + duration, scenario.endTimestampUs);
    if (end <= start) {
      return;
    }

    const pid = finiteNumber(event.pid);
    const tid = finiteNumber(event.tid);
    const lane = pid === null || tid === null ? `unknown:${index}` : `${pid}:${tid}`;
    const lanes = intervals.get(category);
    const laneIntervals = lanes?.get(lane) ?? [];
    laneIntervals.push({ end, start });
    lanes?.set(lane, laneIntervals);
    counts[category] += 1;
  });

  return Object.fromEntries(
    RENDERING_CATEGORIES.map((category) => [
      category,
      {
        eventCount: counts[category],
        totalDurationMs: roundMilliseconds(
          [...(intervals.get(category)?.values() ?? [])].reduce(
            (total, laneIntervals) => total + mergedDuration(laneIntervals),
            0,
          ) / 1_000,
        ),
      },
    ]),
  ) as unknown as ChromiumTraceRenderingSummary;
}

function rendererLongTasks(
  events: readonly TraceEvent[],
  processes: readonly ChromiumTraceProcess[],
  scenario: ScenarioInterval,
): ChromiumTraceRendererLongTasks[] {
  return processes
    .filter(({ isRenderer }) => isRenderer)
    .map(({ name: processNameValue, pid }) => {
      const tasks = events.flatMap((event) => {
        const timestamp = finiteNumber(event.ts);
        const duration = finiteNumber(event.dur);
        return event.name === 'RunTask' &&
          event.pid === pid &&
          timestamp !== null &&
          duration !== null &&
          duration > 50_000 &&
          timestamp >= scenario.startTimestampUs &&
          timestamp <= scenario.endTimestampUs
          ? [duration]
          : [];
      });

      return {
        count: tasks.length,
        maximumDurationMs:
          tasks.length === 0
            ? null
            : roundMilliseconds(Math.max(...tasks) / 1_000),
        pid,
        processName: processNameValue,
        totalDurationMs: roundMilliseconds(
          tasks.reduce((total, duration) => total + duration, 0) / 1_000,
        ),
      };
    });
}

export function analyzeChromiumTrace(
  input: ChromiumTraceInput,
  { refreshIntervalMs }: ChromiumTraceAnalysisOptions,
): ChromiumTraceAnalysis {
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) {
    throw new RangeError('refreshIntervalMs must be a positive finite number.');
  }

  const events = parseTraceEvents(input);
  const processes = collectProcesses(events);
  const markers = collectMarkers(events);

  return {
    markerEvents: markers.markerEvents,
    markers: markers.markers,
    processes,
    refreshIntervalMs,
    scenarios: markers.scenarios.map((scenario) => ({
      durationMs: roundMilliseconds(
        (scenario.endTimestampUs - scenario.startTimestampUs) / 1_000,
      ),
      endTimestampUs: scenario.endTimestampUs,
      frames: {
        displayed: frameSeries(
          events,
          'Display::FrameDisplayed',
          scenario,
          refreshIntervalMs,
        ),
        presented: frameSeries(
          events,
          'FramePresented',
          scenario,
          refreshIntervalMs,
        ),
      },
      label: scenario.label,
      occurrence: scenario.occurrence,
      pipelineReporter: pipelineReporterSummary(events, scenario),
      rendererLongTasks: rendererLongTasks(events, processes, scenario),
      rendering: renderingSummary(events, scenario),
      startTimestampUs: scenario.startTimestampUs,
    })),
    traceEvents: events.length,
  };
}
