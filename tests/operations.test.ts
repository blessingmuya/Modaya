import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, operationSchema } from '../src/lib/ops/operations.ts';
import { buildCutRanges, gradeFromMeasured, pickTargetShot, planFromProfile } from '../src/lib/ops/plan-from-profile.ts';
import { clipsDuration } from '../src/lib/timeline/ops.ts';
import type { Clip, TimelineSpec } from '../src/lib/timeline/spec.ts';
import type { MeasuredLayer } from '../src/lib/style/types.ts';

const ASSET = '11111111-1111-4111-8111-111111111111';
const clip = (inSec: number, outSec: number, id = `c${inSec}`): Clip => ({ id, assetId: ASSET, inSec, outSec });
const spec = (clips: Clip[]): TimelineSpec => ({ version: 1, clips });

const ctx = { outputDurationSec: 10, sourceDurationSec: 30 };

test('operation schema rejects unknown operation types', () => {
  assert.equal(operationSchema.safeParse({ op: 'delete_everything' }).success, false);
  assert.equal(operationSchema.safeParse({ op: 'trim_to', startSec: 1, endSec: 2 }).success, true);
});

test('remove_ranges clamps timestamps to the media and records what it did', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    { operation: { op: 'remove_ranges', ranges: [{ startSec: 2, endSec: 4 }, { startSec: 50, endSec: 80 }], timebase: 'output' } },
  ], ctx);

  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.dropped.length, 0);
  assert.equal(clipsDuration(outcome.spec.clips), 8);
  assert.match(outcome.applied[0].detail, /1 range\(s\) removed/);
});

test('an operation that would remove the whole timeline is dropped, not applied', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    { operation: { op: 'remove_ranges', ranges: [{ startSec: -5, endSec: 99 }], timebase: 'output' } },
  ], ctx);

  assert.equal(outcome.applied.length, 0);
  assert.equal(outcome.dropped.length, 1);
  assert.match(outcome.dropped[0].reason, /outside the media|remove everything/);
  assert.equal(clipsDuration(outcome.spec.clips), 10, 'timeline must be untouched');
});

test('ranges entirely outside the media are dropped with a reason', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    { operation: { op: 'remove_ranges', ranges: [{ startSec: 40, endSec: 60 }], timebase: 'output' } },
  ], ctx);
  assert.equal(outcome.applied.length, 0);
  assert.match(outcome.dropped[0].reason, /outside the media/);
});

test('grade parameters are clamped to sane bounds', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    { operation: { op: 'grade', contrast: 99, saturation: -5, brightness: 0.2, gamma: 0.0001 } },
  ], ctx);

  assert.equal(outcome.applied.length, 1);
  assert.deepEqual(outcome.spec.grade, { contrast: 3, saturation: 0, brightness: 0.2, gamma: 0.1 });
  assert.match(outcome.applied[0].detail, /contrast=3/);
});

test('punch_in scale is clamped and empty windows are discarded', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    {
      operation: {
        op: 'punch_in',
        punchIns: [
          { startSec: 1, endSec: 2, scale: 9 },
          { startSec: 20, endSec: 22, scale: 1.2 },
        ],
      },
    },
  ], ctx);

  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.spec.punchIns?.length, 1);
  assert.equal(outcome.spec.punchIns?.[0].scale, 3);
});

test('captions outside the timeline are discarded and text is normalised', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    {
      operation: {
        op: 'add_captions',
        position: 'top',
        captions: [
          { startSec: 1, endSec: 3, text: '  hello   world ' },
          { startSec: 30, endSec: 33, text: 'way past the end' },
        ],
      },
    },
  ], ctx);

  assert.equal(outcome.spec.captions?.length, 1);
  assert.equal(outcome.spec.captions?.[0].text, 'hello world');
  assert.equal(outcome.spec.captions?.[0].position, 'top');
});

test('unknown fields in a proposed operation are rejected rather than trusted', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    { operation: { op: 'trim_to', startSec: 1, endSec: 2, deleteSourceFile: true } },
  ], ctx);
  // trim_to is applied; the stray field is gone because the parsed object is used.
  assert.equal(outcome.applied.length, 1);
  assert.equal((outcome.spec as Record<string, unknown>).deleteSourceFile, undefined);
});

test('grounding travels with the operation that used it', () => {
  const outcome = applyOperations(spec([clip(0, 10)]), [
    {
      operation: { op: 'grade', saturation: 1.2 },
      grounding: {
        source: 'style_profile',
        field: 'measured.grade.saturation',
        value: '0.75',
        reason: 'Reference is more saturated than the source.',
      },
    },
  ], ctx);

  assert.equal(outcome.grounding.length, 1);
  assert.equal(outcome.grounding[0].field, 'measured.grade.saturation');
});

// ---------------------------------------------------------------- planning ---

const measured = (overrides: Partial<MeasuredLayer> = {}): MeasuredLayer => ({
  source: 'measured',
  schemaVersion: 2,
  durationSec: 20,
  sampledFps: 8,
  cutResolutionSec: 0.125,
  cuts: {
    cutTimesSec: [1.5, 3.0, 4.5],
    resolutionSec: 0.125,
    threshold: 8,
    medianFrameDiff: 0.4,
    meanFrameDiff: 3,
    p95FrameDiff: 20,
    robustSigma: 0.6,
  },
  shots: { count: 4, meanSec: 1.5, medianSec: 1.5, minSec: 1.2, maxSec: 1.8, stdevSec: 0.25 },
  audio: {
    meanRmsDb: -30,
    activeMeanRmsDb: -18,
    activeRatio: 0.8,
    peakRmsDb: -6,
    silenceRanges: [],
    silenceRatio: 0,
    onsetsSec: [1.5, 3.0],
    onsetsPerMinute: 6,
    windowSec: 0.025,
    hopSec: 0.01,
    silenceThresholdDb: -45,
  },
  grade: { meanR: 120, meanG: 100, meanB: 90, meanLuma: 105, contrast: 60, saturation: 0.7, warmth: 30 },
  media: { width: 1080, height: 1920, fps: 30, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac' },
  ...overrides,
});

test('pickTargetShot bounds pathological values', () => {
  assert.equal(pickTargetShot(measured()), 1.5);
  assert.equal(pickTargetShot(measured({ shots: { ...measured().shots, medianSec: 0.02 } })), 0.4);
  assert.equal(pickTargetShot(measured({ shots: { ...measured().shots, medianSec: 900 } })), 12);
});

test('buildCutRanges is deterministic and produces beats near the target length', () => {
  const clips = [clip(0, 30)];
  const first = buildCutRanges(clips, 2);
  const second = buildCutRanges(clips, 2);
  assert.deepEqual(first, second);
  assert.ok(first.length > 5, `expected several beats, got ${first.length}`);
  // Period between cut starts is the beat plus the removed chunk.
  const period = first[1].startSec - first[0].startSec;
  assert.ok(period > 2 && period < 2.5, `period ${period}`);
});

test('planFromProfile grounds every operation in a real measured field', () => {
  const plan = planFromProfile({
    reference: { assetId: 'ref', measured: measured(), model: null },
    clips: [clip(0, 30)],
    source: { assetId: ASSET, durationSec: 30, grade: { meanLuma: 80, contrast: 30, saturation: 0.4, warmth: 5 } },
  });

  assert.ok(plan.operations.length >= 2, 'expected pacing and grade operations');
  for (const proposed of plan.operations) {
    assert.ok(proposed.grounding, 'every automatic operation needs a grounding');
    assert.equal(proposed.grounding!.source, 'style_profile');
  }
  const fields = plan.operations.map((op) => op.grounding!.field);
  assert.ok(fields.includes('measured.shots.medianSec'));
  assert.ok(fields.includes('measured.grade'));
  assert.ok(plan.summary.length >= 2);
  assert.ok(plan.usedFields.includes('measured.shots.medianSec'));
});

test('planFromProfile survives a profile with no usable measurements', () => {
  const empty = measured({
    shots: { count: 0, meanSec: 0, medianSec: 0, minSec: 0, maxSec: 0, stdevSec: 0 },
    cuts: { ...measured().cuts, cutTimesSec: [] },
  });
  const plan = planFromProfile({
    reference: { assetId: 'ref', measured: empty, model: null },
    clips: [clip(0, 10)],
    source: { assetId: ASSET, durationSec: 10, grade: null },
  });
  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.usedFields, []);
});

test('gradeFromMeasured only emits parameters that differ meaningfully', () => {
  const identical = gradeFromMeasured(measured(), {
    meanLuma: 105,
    contrast: 60,
    saturation: 0.7,
    warmth: 30,
  });
  assert.equal(identical, null, 'no grade when the source already matches');

  const different = gradeFromMeasured(measured(), {
    meanLuma: 60,
    contrast: 20,
    saturation: 0.3,
    warmth: 0,
  });
  assert.ok(different);
  assert.ok((different!.values.contrast ?? 1) > 1, 'reference has more contrast');
  assert.ok((different!.values.saturation ?? 1) > 1, 'reference is more saturated');
  assert.ok((different!.values.brightness ?? 0) > 0, 'reference is brighter');
  assert.match(different!.reason, /measured colour statistics/);
});

test('the reference plan, once applied, changes the timeline in the expected direction', () => {
  const plan = planFromProfile({
    reference: { assetId: 'ref', measured: measured(), model: null },
    clips: [clip(0, 30)],
    source: { assetId: ASSET, durationSec: 30, grade: null },
  });

  const outcome = applyOperations(spec([clip(0, 30)]), plan.operations, {
    outputDurationSec: 30,
    sourceDurationSec: 30,
  });

  assert.equal(outcome.dropped.length, 0, JSON.stringify(outcome.dropped));
  const before = 30;
  const after = clipsDuration(outcome.spec.clips);
  assert.ok(after < before, `expected a shorter edit, ${before}s -> ${after}s`);
  // Resulting clips should mostly be ~1.5s beats.
  const lengths = outcome.spec.clips.map((c) => c.outSec - c.inSec);
  const median = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)];
  assert.ok(median > 1 && median < 3.5, `median beat ${median}`);
});
