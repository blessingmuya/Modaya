import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipDuration,
  createSpec,
  isTimelineSpec,
  normalizeClips,
  placeClips,
  totalDuration,
} from '../src/lib/timeline/spec.ts';
import { invalidSpecReason } from '../src/lib/timeline/validate.ts';
import {
  concat,
  clipsDuration,
  keepRanges,
  mergeRanges,
  removeOutputRanges,
  removeSourceRanges,
  trimTo,
} from '../src/lib/timeline/ops.ts';
import type { Clip } from '../src/lib/timeline/spec.ts';

const ASSET = '11111111-1111-4111-8111-111111111111';
const clip = (inSec: number, outSec: number, id = `c${inSec}`): Clip => ({ id, assetId: ASSET, inSec, outSec });

test('placeClips maps clips onto output time', () => {
  const placed = placeClips([clip(10, 12), clip(20, 21.5)]);
  assert.deepEqual(
    placed.map((p) => [p.outStart, p.outEnd]),
    [
      [0, 2],
      [2, 3.5],
    ],
  );
  assert.equal(totalDuration([clip(10, 12), clip(20, 21.5)]), 3.5);
});

test('removeOutputRanges cuts the middle out of a clip', () => {
  const clips = [clip(0, 10)];
  const result = removeOutputRanges(clips, [{ startSec: 3, endSec: 5 }]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((c) => [c.inSec, c.outSec]),
    [
      [0, 3],
      [5, 10],
    ],
  );
  assert.equal(clipsDuration(result), 8);
});

test('removeOutputRanges maps output time back to source time across clips', () => {
  // Output: [0,2) is source 100-102, [2,5) is source 200-203.
  const clips = [clip(100, 102, 'a'), clip(200, 203, 'b')];
  const result = removeOutputRanges(clips, [{ startSec: 1, endSec: 4 }]);
  assert.deepEqual(
    result.map((c) => [c.inSec, c.outSec]),
    [
      [100, 101],
      [202, 203],
    ],
  );
});

test('removeOutputRanges ignores ranges outside the timeline', () => {
  const clips = [clip(0, 4)];
  const result = removeOutputRanges(clips, [
    { startSec: 10, endSec: 12 },
    { startSec: -5, endSec: -1 },
  ]);
  assert.equal(clipsDuration(result), 4);
});

test('removeOutputRanges with a full-length range leaves nothing', () => {
  const result = removeOutputRanges([clip(0, 4)], [{ startSec: 0, endSec: 4 }]);
  assert.equal(result.length, 0);
});

test('trimTo keeps only the requested window', () => {
  const result = trimTo([clip(0, 10)], { startSec: 2, endSec: 5 });
  assert.deepEqual(
    result.map((c) => [c.inSec, c.outSec]),
    [[2, 5]],
  );
});

test('removeSourceRanges works in source time (the "cut the silences" case)', () => {
  const result = removeSourceRanges([clip(0, 10)], [
    { startSec: 1, endSec: 2 },
    { startSec: 5, endSec: 6 },
  ]);
  assert.deepEqual(
    result.map((c) => [c.inSec, c.outSec]),
    [
      [0, 1],
      [2, 5],
      [6, 10],
    ],
  );
});

test('mergeRanges merges overlapping and touching ranges', () => {
  assert.deepEqual(mergeRanges([
    { startSec: 5, endSec: 7 },
    { startSec: 1, endSec: 3 },
    { startSec: 2, endSec: 4 },
    { startSec: 7, endSec: 9 },
  ]), [
    { startSec: 1, endSec: 4 },
    { startSec: 5, endSec: 9 },
  ]);
});

test('keepRanges returns the complement', () => {
  assert.deepEqual(keepRanges([{ startSec: 2, endSec: 4 }], { startSec: 0, endSec: 10 }), [
    { startSec: 0, endSec: 2 },
    { startSec: 4, endSec: 10 },
  ]);
});

test('concat preserves order and totals duration', () => {
  const result = concat([clip(0, 2, 'a')], [clip(5, 6, 'b')]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'a');
  assert.equal(clipsDuration(result), 3);
});

test('normalizeClips drops clips that are too short to render', () => {
  const result = normalizeClips([clip(0, 5), clip(6, 6.01)]);
  assert.equal(result.length, 1);
  assert.equal(clipDuration(result[0]), 5);
});

test('createSpec produces a valid spec', () => {
  const spec = createSpec([clip(0, 3.14159)]);
  assert.equal(invalidSpecReason(spec), null);
  assert.equal(isTimelineSpec(spec), true);
  assert.equal(spec.clips[0].outSec, 3.142);
});

test('isTimelineSpec is a cheap structural check for the browser bundle', () => {
  assert.equal(isTimelineSpec({ version: 1, clips: [clip(0, 1)] }), true);
  assert.equal(isTimelineSpec({ version: 2, clips: [clip(0, 1)] }), false);
  assert.equal(isTimelineSpec({ version: 1, clips: 'nope' }), false);
  assert.equal(isTimelineSpec(null), false);
});

test('spec validation rejects inverted clips and empty clip lists', () => {
  assert.match(String(invalidSpecReason({ version: 1, clips: [] })), /at least 1/);
  assert.match(
    String(invalidSpecReason({ version: 1, clips: [clip(5, 1)] })),
    /outSec greater than inSec/,
  );
  assert.match(
    String(invalidSpecReason({ version: 1, clips: [{ id: 'x', assetId: 'not-a-uuid', inSec: 0, outSec: 1 }] })),
    /assetId/,
  );
});
