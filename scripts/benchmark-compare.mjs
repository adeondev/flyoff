import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Run the large-note benchmark several times and report the median of each
 * measure across runs.
 *
 * A single run on a shared or two-core machine moves by more than most of the
 * changes worth making. Repeating the whole run and taking medians across runs
 * separates a real change from the machine having a bad minute, and keeping the
 * reference editors in the same runs gives a ratio that is immune to it.
 *
 *   node scripts/benchmark-compare.mjs --runs=5 --lines=20000 --out=results.json
 *   node scripts/benchmark-compare.mjs --compare=before.json --out=after.json
 */

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, value = 'true'] = entry.replace(/^--/u, '').split('=');
    return [key, value];
  }),
);

const runs = Number(args.get('runs') ?? 5);
const lines = args.get('lines') ?? '20000';
const throttle = args.get('throttle');
const outPath = args.get('out');
const comparePath = args.get('compare');
// The reference editors mount the fixture seven times each. Past ~50.000 lines
// that exhausts the renderer on a small machine, and the question at those sizes
// is how Flyoff itself scales.
const skipReference = args.get('skip-reference') === 'true';
const root = path.resolve(import.meta.dirname, '..');

const METRICS = [
  ['source.initial', 'Blink open (warm)'],
  ['source.keystroke', 'Blink keystroke'],
  ['source.edit', 'Blink model+render'],
  ['source.editBreakdown.sourceUpdate', '  setSource'],
  ['source.editBreakdown.inputRead', '  read input'],
  ['source.editBreakdown.reveal', '  reveal caret'],
  ['source.wheelScroll.frameTime', 'Blink wheel scroll'],
  ['source.scroll.frameTime', 'Blink fling scroll'],
  ['preview.initial', 'Blink reading open'],
  ['preview.edit', 'Blink reading edit'],
  ['codemirror.initial', 'CodeMirror 6 open'],
  ['codemirror.edit', 'CodeMirror 6 edit'],
  ['codemirror.wheelScroll.frameTime', 'CodeMirror 6 wheel'],
  ['monaco.initial', 'Monaco open'],
  ['monaco.edit', 'Monaco edit'],
  ['monaco.wheelScroll.frameTime', 'Monaco wheel'],
];

/**
 * Ratios taken inside each run, then medianed.
 *
 * Absolute milliseconds on a shared two-core machine drift by more between
 * batches than most changes are worth; a ratio against a reference editor
 * measured in the same run cancels that drift out.
 */
const RATIOS = [
  ['source.keystroke', 'codemirror.edit', 'keystroke vs CodeMirror 6'],
  ['source.keystroke', 'monaco.edit', 'keystroke vs Monaco'],
  ['source.initial', 'codemirror.initial', 'open vs CodeMirror 6'],
  ['source.initial', 'monaco.initial', 'open vs Monaco'],
];

const COUNTS = [
  ['source.descendantNodes', 'Blink DOM nodes'],
  ['source.mountedLines', 'Blink mounted lines'],
  ['codemirror.descendantNodes', 'CodeMirror 6 DOM nodes'],
  ['monaco.descendantNodes', 'Monaco DOM nodes'],
];

function pick(source, dotted) {
  return dotted.split('.').reduce((value, key) => value?.[key], source);
}

function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length === 0 ? undefined : sorted[sorted.length >> 1];
}

function runOnce(index) {
  process.stderr.write(`run ${index + 1}/${runs}\n`);
  const output = execFileSync(
    path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
    [
      '--no-sandbox',
      '--ozone-platform=headless',
      '--disable-gpu',
      path.join(root, 'scripts', 'benchmark-large-notes.cjs'),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        FLYOFF_BENCHMARK_CPU_THROTTLE: throttle ?? '',
        FLYOFF_BENCHMARK_LINES: lines,
        FLYOFF_BENCHMARK_SKIP_LEGACY: '1',
        FLYOFF_BENCHMARK_SKIP_REFERENCE: skipReference ? '1' : '',
      },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return JSON.parse(output);
}

function aggregate(results) {
  const summary = { counts: {}, metrics: {} };
  for (const [dotted] of METRICS) {
    const samples = results.map((result) => pick(result, dotted));
    if (samples.some((sample) => sample === undefined)) {
      continue;
    }
    summary.metrics[dotted] = {
      maximumMs: median(samples.map((s) => s.maximumMs)),
      medianMs: median(samples.map((s) => s.medianMs)),
      p95Ms: median(samples.map((s) => s.p95Ms)),
      p99Ms: median(samples.map((s) => s.p99Ms)),
      runs: samples.length,
      samplesPerRun: samples[0].iterations,
      standardDeviationMs: median(samples.map((s) => s.standardDeviationMs)),
    };
  }
  summary.ratios = {};
  for (const [numerator, denominator, label] of RATIOS) {
    const samples = results
      .map((result) => {
        const top = pick(result, numerator)?.medianMs;
        const bottom = pick(result, denominator)?.medianMs;
        return top !== undefined && bottom ? top / bottom : undefined;
      })
      .filter((value) => value !== undefined);
    if (samples.length === results.length) {
      summary.ratios[label] = median(samples);
    }
  }
  for (const [dotted] of COUNTS) {
    const samples = results.map((result) => pick(result, dotted));
    if (samples.every((sample) => typeof sample === 'number')) {
      summary.counts[dotted] = median(samples);
    }
  }
  summary.environment = {
    cpuThrottlingRate: results[0]?.cpuThrottlingRate ?? 1,
    fixture: results[0]?.fixture,
    runs: results.length,
    viewport: results[0]?.viewport,
  };
  return summary;
}

function format(value) {
  return value === undefined ? '—' : value.toFixed(2);
}

function report(summary, baseline) {
  const rows = [];
  for (const [dotted, label] of METRICS) {
    const entry = summary.metrics[dotted];
    if (!entry) {
      continue;
    }
    const before = baseline?.metrics?.[dotted];
    rows.push(
      [
        label.padEnd(22),
        format(entry.medianMs).padStart(8),
        format(entry.p95Ms).padStart(8),
        format(entry.p99Ms).padStart(8),
        format(entry.standardDeviationMs).padStart(7),
        before
          ? `${format(before.medianMs)} → ${format(entry.medianMs)}`.padStart(
              18,
            )
          : '',
      ].join(' '),
    );
  }
  process.stdout.write(
    `${'metric'.padEnd(22)} ${'median'.padStart(8)} ${'p95'.padStart(
      8,
    )} ${'p99'.padStart(8)} ${'sd'.padStart(7)}${
      baseline ? ' median before → after'.padStart(19) : ''
    }\n`,
  );
  process.stdout.write(`${rows.join('\n')}\n\n`);
  for (const [label, value] of Object.entries(summary.ratios ?? {})) {
    const before = baseline?.ratios?.[label];
    process.stdout.write(
      `${label.padEnd(26)} ${value.toFixed(2)}×${
        before ? `   (before ${before.toFixed(2)}×)` : ''
      }\n`,
    );
  }
  process.stdout.write('\n');
  for (const [dotted, label] of COUNTS) {
    if (summary.counts[dotted] !== undefined) {
      process.stdout.write(
        `${label.padEnd(24)} ${String(summary.counts[dotted]).padStart(8)}\n`,
      );
    }
  }
  process.stdout.write(
    `\nruns ${summary.environment.runs} · lines ${
      summary.environment.fixture?.lines
    } · chars ${summary.environment.fixture?.characters} · cpu throttle ${
      summary.environment.cpuThrottlingRate
    }×\n`,
  );
}

const results = [];
for (let index = 0; index < runs; index += 1) {
  results.push(runOnce(index));
}
const summary = aggregate(results);
if (outPath) {
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(path.resolve(outPath), `${JSON.stringify(summary, null, 2)}\n`);
}
report(
  summary,
  comparePath
    ? JSON.parse(readFileSync(path.resolve(comparePath), 'utf8'))
    : undefined,
);
