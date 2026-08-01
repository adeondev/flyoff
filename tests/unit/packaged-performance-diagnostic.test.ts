import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH,
  PERFORMANCE_DIAGNOSTIC_SWITCH,
  PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH,
  PERFORMANCE_DIAGNOSTIC_TRACE_SWITCH,
  parsePackagedPerformanceDiagnosticOptions,
} from '../../src/main/performance/packaged-performance-diagnostic';
import { rendererPerformanceDiagnosticSource } from '../../src/main/performance/renderer-performance-diagnostic';

describe('packaged performance diagnostic options', () => {
  it('serializes the isolated renderer bootstrap as executable JavaScript', () => {
    const source = rendererPerformanceDiagnosticSource({
      ablation: 'transitions-off',
      lineCount: 11_000,
      refreshRate: 60,
    });

    expect(new Function(`return () => ${source}`)()).toBeTypeOf('function');
    expect(source).toContain('"lineCount":11000');
    expect(source).toContain('"ablation":"transitions-off"');
    expect(source).toContain('performanceDiagnosticAblation');
    expect(source).toContain('container-type: normal !important');
    expect(source).toContain('transition: none !important');
    expect(source).toContain('performanceDiagnosticPrimary');
  });

  it('derives a trace beside an absolute report path', () => {
    const reportPath = path.resolve('test-results', 'performance.json');

    expect(
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
      ]),
    ).toEqual({
      ablation: 'current',
      lineCount: 11_000,
      reportPath: path.normalize(reportPath),
      suite: 'full',
      traceMode: 'full',
      tracePath: path.join(path.dirname(reportPath), 'performance.trace.json'),
    });
  });

  it('parses the short controls suite without Chromium tracing', () => {
    const reportPath = path.resolve('performance.json');
    expect(
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
        `--${PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH}=controls`,
        `--${PERFORMANCE_DIAGNOSTIC_TRACE_SWITCH}=off`,
      ]),
    ).toMatchObject({ suite: 'controls', traceMode: 'off' });
  });

  it('defaults the static editor ablation to the resize suite', () => {
    const reportPath = path.resolve('performance.json');

    expect(
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
        `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=editor-static`,
      ]),
    ).toMatchObject({ ablation: 'editor-static', suite: 'resize' });
  });

  it.each(['transitions-off', 'container-queries-off'] as const)(
    'parses the %s ablation',
    (ablation) => {
      const reportPath = path.resolve('performance.json');

      expect(
        parsePackagedPerformanceDiagnosticOptions([
          'Flyoff.exe',
          `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
          `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=${ablation}`,
          `--${PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH}=resize`,
        ]),
      ).toMatchObject({ ablation, suite: 'resize' });
    },
  );

  it('rejects a full editor suite with the static rectangle', () => {
    const reportPath = path.resolve('performance.json');

    expect(() =>
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
        `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=editor-static`,
        `--${PERFORMANCE_DIAGNOSTIC_SUITE_SWITCH}=full`,
      ]),
    ).toThrow(/cannot run the full editor suite/);
  });

  it('rejects invalid or duplicate ablations', () => {
    const reportPath = path.resolve('performance.json');

    expect(() =>
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
        `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=paint-off`,
      ]),
    ).toThrow(/must be current/);
    expect(() =>
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
        `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=current`,
        `--${PERFORMANCE_DIAGNOSTIC_ABLATION_SWITCH}=transitions-off`,
      ]),
    ).toThrow(/Only one .*ablation/);
  });

  it('does not enable diagnostics without the dedicated switch', () => {
    expect(
      parsePackagedPerformanceDiagnosticOptions(['Flyoff.exe']),
    ).toBeNull();
  });

  it.each([
    `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=relative.json`,
    `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${path.resolve('report.txt')}`,
    `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=`,
  ])('rejects an invalid report target: %s', (argument) => {
    expect(() =>
      parsePackagedPerformanceDiagnosticOptions(['Flyoff.exe', argument]),
    ).toThrow(/absolute \.json file/);
  });

  it('rejects duplicate diagnostic targets', () => {
    const reportPath = path.resolve('performance.json');
    expect(() =>
      parsePackagedPerformanceDiagnosticOptions([
        'Flyoff.exe',
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
        `--${PERFORMANCE_DIAGNOSTIC_SWITCH}=${reportPath}`,
      ]),
    ).toThrow(/Only one performance diagnostic/);
  });
});
