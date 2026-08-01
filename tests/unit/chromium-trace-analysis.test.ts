import { describe, expect, it } from 'vitest';

import { analyzeChromiumTrace } from '../../src/main/performance/chromium-trace-analysis';

describe('Chromium trace analysis', () => {
  it('summarizes frames, pipeline states, rendering work and renderer long tasks', () => {
    const trace = {
      traceEvents: [
        {
          args: { name: 'Browser' },
          name: 'process_name',
          ph: 'M',
          pid: 1,
          ts: 0,
        },
        {
          args: { name: 'Renderer' },
          name: 'process_name',
          ph: 'M',
          pid: 2,
          ts: 0,
        },
        {
          args: { name: 'Renderer: extension' },
          name: 'process_name',
          ph: 'M',
          pid: 4,
          ts: 0,
        },
        {
          args: { name: 'GPU Process' },
          name: 'process_name',
          ph: 'M',
          pid: 3,
          ts: 0,
        },
        { name: 'flyoff-diagnostic:scroll:start', ph: 'R', pid: 2, ts: 100_000 },
        { name: 'flyoff-diagnostic:scroll:end', ph: 'R', pid: 2, ts: 800_000 },
        ...[110_000, 120_000, 140_000, 170_000, 210_000, 260_000, 260_000].map(
          (ts) => ({ name: 'Display::FrameDisplayed', ph: 'I', pid: 3, ts }),
        ),
        ...[115_000, 120_000, 130_000].map((ts) => ({
          name: 'FramePresented',
          ph: 'R',
          pid: 1,
          ts,
        })),
        {
          args: {
            frame_reporter: {
              checkerboarded_needs_raster: false,
              has_high_latency: true,
              has_missing_content: false,
              state: 'STATE_PRESENTED_PARTIAL',
            },
          },
          name: 'PipelineReporter',
          ph: 'b',
          ts: 150_000,
        },
        {
          args: {
            frame_reporter: {
              checkerboarded_needs_record: true,
              has_high_latency: false,
              has_missing_content: true,
              state: 'STATE_DROPPED',
            },
          },
          name: 'PipelineReporter',
          ph: 'b',
          ts: 160_000,
        },
        {
          args: { frame_reporter: { state: 'STATE_NO_UPDATE_DESIRED' } },
          name: 'PipelineReporter',
          ph: 'b',
          ts: 170_000,
        },
        { args: {}, name: 'PipelineReporter', ph: 'e', ts: 180_000 },
        {
          cat: 'blink',
          dur: 40_000,
          name: 'LocalFrameView::UpdateStyleAndLayout',
          ph: 'X',
          pid: 2,
          tid: 20,
          ts: 90_000,
        },
        {
          cat: 'blink',
          dur: 10_000,
          name: 'Blink.Layout.UpdateTime',
          ph: 'X',
          pid: 2,
          tid: 20,
          ts: 110_000,
        },
        {
          cat: 'blink',
          dur: 10_000,
          name: 'Blink.Paint.UpdateTime',
          ph: 'X',
          pid: 2,
          tid: 20,
          ts: 300_000,
        },
        {
          cat: 'cc',
          dur: 20_000,
          name: 'RasterTask',
          ph: 'X',
          pid: 2,
          tid: 21,
          ts: 400_000,
        },
        {
          cat: 'cc',
          dur: 5_000,
          name: 'RasterizerTaskImpl::RunOnWorkerThread',
          ph: 'X',
          pid: 2,
          tid: 21,
          ts: 405_000,
        },
        {
          cat: 'viz',
          dur: 30_000,
          name: 'Graphics.Pipeline',
          ph: 'X',
          pid: 3,
          tid: 30,
          ts: 500_000,
        },
        {
          cat: 'viz',
          dur: 10_000,
          name: 'DirectRenderer::DrawFrame',
          ph: 'X',
          pid: 3,
          tid: 30,
          ts: 505_000,
        },
        {
          cat: 'disabled-by-default-devtools.timeline',
          dur: 60_000,
          name: 'RunTask',
          ph: 'X',
          pid: 2,
          tid: 20,
          ts: 600_000,
        },
        {
          cat: 'toplevel',
          dur: 59_000,
          name: 'ThreadControllerImpl::RunTask',
          ph: 'X',
          pid: 2,
          tid: 20,
          ts: 601_000,
        },
        {
          dur: 50_000,
          name: 'RunTask',
          ph: 'X',
          pid: 2,
          tid: 20,
          ts: 700_000,
        },
        {
          dur: 90_000,
          name: 'RunTask',
          ph: 'X',
          pid: 1,
          tid: 10,
          ts: 650_000,
        },
      ],
    };

    const report = analyzeChromiumTrace(trace, { refreshIntervalMs: 10 });
    const scenario = report.scenarios[0];

    expect(report.processes).toEqual([
      { isRenderer: false, name: 'Browser', pid: 1 },
      { isRenderer: true, name: 'Renderer', pid: 2 },
      { isRenderer: false, name: 'GPU Process', pid: 3 },
      { isRenderer: true, name: 'Renderer: extension', pid: 4 },
    ]);
    expect(scenario).toMatchObject({
      durationMs: 700,
      endTimestampUs: 800_000,
      label: 'scroll',
      occurrence: 1,
      startTimestampUs: 100_000,
    });
    expect(scenario?.frames.displayed).toMatchObject({
      duplicateTimestamps: 1,
      eventCount: 7,
      intervalsMs: [10, 20, 30, 40, 50],
      timestampsUs: [110_000, 120_000, 140_000, 170_000, 210_000, 260_000],
    });
    expect(scenario?.frames.displayed.timing).toEqual({
      beyondFourRefreshes: 1,
      intervalCount: 5,
      maximumMs: 50,
      medianMs: 30,
      p95Ms: 50,
      p99Ms: 50,
      refreshBuckets: [
        { intervals: 1, multiple: 1, targetMs: 10 },
        { intervals: 1, multiple: 2, targetMs: 20 },
        { intervals: 1, multiple: 3, targetMs: 30 },
        { intervals: 1, multiple: 4, targetMs: 40 },
      ],
    });
    expect(scenario?.pipelineReporter).toEqual({
      events: 3,
      flags: { checkerboard: 1, highLatency: 1, missingContent: 1 },
      states: { dropped: 1, other: 1, presented: 1 },
    });
    expect(scenario?.rendering).toEqual({
      compositorViz: { eventCount: 2, totalDurationMs: 30 },
      paintPrepaint: { eventCount: 1, totalDurationMs: 10 },
      raster: { eventCount: 2, totalDurationMs: 20 },
      styleLayout: { eventCount: 2, totalDurationMs: 30 },
    });
    expect(scenario?.rendererLongTasks).toEqual([
      {
        count: 1,
        maximumDurationMs: 60,
        pid: 2,
        processName: 'Renderer',
        totalDurationMs: 60,
      },
      {
        count: 0,
        maximumDurationMs: null,
        pid: 4,
        processName: 'Renderer: extension',
        totalDurationMs: 0,
      },
    ]);
  });

  it('prefers PerformanceMark edges, falls back to TimeStamp and exposes unmatched markers', () => {
    const traceEvents = [
      { name: 'flyoff-diagnostic:primary:start', ts: 100 },
      { name: 'flyoff-diagnostic:primary:end', ts: 200 },
      {
        args: { data: { message: 'flyoff-diagnostic:primary:start' } },
        name: 'TimeStamp',
        ts: 101,
      },
      {
        args: { data: { message: 'flyoff-diagnostic:primary:end' } },
        name: 'TimeStamp',
        ts: 201,
      },
      {
        args: { data: { message: 'flyoff-diagnostic:fallback:start' } },
        name: 'TimeStamp',
        ts: 300,
      },
      {
        args: { data: { message: 'flyoff-diagnostic:fallback:end' } },
        name: 'TimeStamp',
        ts: 500,
      },
      { name: 'flyoff-diagnostic:missing-end:start', ts: 700 },
      { name: 'flyoff-diagnostic:missing-start:end', ts: 800 },
      { name: 'flyoff-diagnostic:reversed:end', ts: 900 },
      { name: 'flyoff-diagnostic:reversed:start', ts: 1_000 },
    ];

    const report = analyzeChromiumTrace(JSON.stringify(traceEvents), {
      refreshIntervalMs: 16.67,
    });

    expect(report.markerEvents).toBe(10);
    expect(report.scenarios.map(({ endTimestampUs, label, startTimestampUs }) => ({
      endTimestampUs,
      label,
      startTimestampUs,
    }))).toEqual([
      { endTimestampUs: 200, label: 'primary', startTimestampUs: 100 },
      { endTimestampUs: 500, label: 'fallback', startTimestampUs: 300 },
    ]);
    expect(report.markers.find(({ label }) => label === 'primary')).toMatchObject({
      endSource: 'performance-mark',
      endTimestampsUs: [200],
      pairedIntervals: 1,
      sources: {
        performanceMark: { ends: 1, starts: 1 },
        timeStamp: { ends: 1, starts: 1 },
      },
      startSource: 'performance-mark',
      startTimestampsUs: [100],
      unmatchedEnds: 0,
      unmatchedStarts: 0,
    });
    expect(report.markers.find(({ label }) => label === 'fallback')).toMatchObject({
      endSource: 'timestamp',
      pairedIntervals: 1,
      startSource: 'timestamp',
    });
    expect(report.markers.find(({ label }) => label === 'missing-end')).toMatchObject({
      pairedIntervals: 0,
      unmatchedEnds: 0,
      unmatchedStarts: 1,
    });
    expect(report.markers.find(({ label }) => label === 'missing-start')).toMatchObject({
      pairedIntervals: 0,
      unmatchedEnds: 1,
      unmatchedStarts: 0,
    });
    expect(report.markers.find(({ label }) => label === 'reversed')).toMatchObject({
      pairedIntervals: 0,
      unmatchedEnds: 1,
      unmatchedStarts: 1,
    });
  });

  it('rejects invalid trace containers and refresh intervals', () => {
    expect(() =>
      analyzeChromiumTrace({}, { refreshIntervalMs: 16.67 }),
    ).toThrow(TypeError);
    expect(() =>
      analyzeChromiumTrace([], { refreshIntervalMs: 0 }),
    ).toThrow(RangeError);
  });
});
