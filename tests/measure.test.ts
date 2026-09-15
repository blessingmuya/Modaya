import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from '../src/lib/ffmpeg/binaries.ts';
import { analyzeMedia } from '../src/lib/style/analyze.ts';
import {
  analyzeAudio,
  detectCuts,
  frameDifference,
  frameDifferences,
  FRAME_BYTES,
  gradeStats,
  representativeTimes,
  shotStats,
  SAMPLE_FPS,
} from '../src/lib/style/measure.ts';
import { readMeasured } from '../src/lib/style/types.ts';

const execFileAsync = promisify(execFile);

function solidFrame(r: number, g: number, b: number): Uint8Array {
  const frame = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < frame.length; i += 3) {
    frame[i] = r;
    frame[i + 1] = g;
    frame[i + 2] = b;
  }
  return frame;
}

test('frameDifference is 0 for identical frames and large for hard cuts', () => {
  const black = solidFrame(0, 0, 0);
  const white = solidFrame(255, 255, 255);
  assert.equal(frameDifference(black, black), 0);
  assert.equal(frameDifference(black, white), 255);
  assert.equal(frameDifferences([black, black, white]).length, 2);
});

test('detectCuts finds spikes and ignores gentle motion', () => {
  // 8 fps: small drift everywhere, real cuts at frames 8 and 24 (i.e. diff index).
  const diffs = Array.from({ length: 40 }, (_, i) => 1 + (i % 3) * 0.2);
  diffs[8] = 60;
  diffs[24] = 55;

  const result = detectCuts(diffs, { fps: 8 });
  assert.deepEqual(result.cutTimesSec, [1.125, 3.125]);
  assert.equal(result.resolutionSec, 0.125);
  assert.ok(result.threshold > 1 && result.threshold < 60);
});

test('a clip with only hard cuts and no motion still reports those cuts', () => {
  // Regression: a mean/stdev threshold is inflated by the very spikes it is
  // meant to find, so this used to report zero cuts.
  const diffs = new Array(24).fill(0);
  diffs[8] = 180;
  diffs[16] = 175;
  const result = detectCuts(diffs, { fps: 8 });
  assert.equal(result.medianFrameDiff, 0);
  assert.deepEqual(result.cutTimesSec, [1.125, 2.125]);
});

test('detectCuts never registers the same transition twice', () => {
  const diffs = new Array(30).fill(0.5);
  diffs[10] = 80;
  diffs[11] = 70; // same transition leaking into the next frame
  const result = detectCuts(diffs, { fps: 8 });
  assert.equal(result.cutTimesSec.length, 1);
});

test('detectCuts on a completely static clip finds nothing', () => {
  const result = detectCuts(new Array(50).fill(0), { fps: 8 });
  assert.deepEqual(result.cutTimesSec, []);
  assert.equal(result.meanFrameDiff, 0);
});

test('shotStats measures the gaps between cuts', () => {
  const stats = shotStats([2, 5], 10);
  assert.equal(stats.count, 3);
  assert.deepEqual([stats.minSec, stats.maxSec], [2, 5]);
  assert.equal(stats.medianSec, 3);
  assert.ok(stats.meanSec > 3 && stats.meanSec < 4);
});

function tone(seconds: number, sampleRate: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return out;
}

test('analyzeAudio finds silence gaps and onsets in synthetic PCM', () => {
  const sampleRate = 16_000;
  // 0.5s silence, 0.5s tone, 1.5s silence, 1s tone => gaps and two rising edges.
  const samples = new Float32Array(sampleRate * 3.5);
  const blocks = [
    { at: 0.5, audio: tone(0.5, sampleRate) },
    { at: 2.5, audio: tone(1, sampleRate) },
  ];
  for (const block of blocks) samples.set(block.audio, Math.round(block.at * sampleRate));

  const stats = analyzeAudio(samples, sampleRate);
  assert.equal(stats.silenceRanges.length, 2, JSON.stringify(stats.silenceRanges));
  const [first, second] = stats.silenceRanges;
  assert.ok(first.startSec < 0.05, `first gap starts at ${first.startSec}`);
  assert.ok(Math.abs(first.endSec - 0.5) < 0.1, `first gap ends at ${first.endSec}`);
  assert.ok(Math.abs(second.startSec - 1.0) < 0.1, `second gap starts at ${second.startSec}`);
  assert.ok(Math.abs(second.endSec - 2.5) < 0.1, `second gap ends at ${second.endSec}`);
  assert.ok(stats.silenceRatio > 0.5 && stats.silenceRatio < 0.7);

  // Both tones start from silence, so both are onsets.
  assert.equal(stats.onsetsSec.length, 2, JSON.stringify(stats.onsetsSec));
  assert.ok(Math.abs(stats.onsetsSec[0] - 0.5) < 0.1, `onset 1 at ${stats.onsetsSec[0]}`);
  assert.ok(Math.abs(stats.onsetsSec[1] - 2.5) < 0.1, `onset 2 at ${stats.onsetsSec[1]}`);
  assert.ok(stats.peakRmsDb > -10 && stats.peakRmsDb < 0);

  // Averaging dB across digital silence drags the mean down; the active figure
  // is the one that describes how loud the loud parts are.
  assert.ok(stats.activeMeanRmsDb > -15, `active mean ${stats.activeMeanRmsDb}`);
  assert.ok(stats.meanRmsDb < stats.activeMeanRmsDb - 10, 'mean should be dragged down by silence');
  assert.ok(stats.activeRatio > 0.35 && stats.activeRatio < 0.55, `active ratio ${stats.activeRatio}`);
});

test('a clip that starts already loud has no onset at t=0', () => {
  // An onset is a rise above a quiet baseline; there is no baseline at the start.
  const stats = analyzeAudio(tone(1, 16_000), 16_000);
  assert.equal(stats.onsetsSec.length, 0);
  assert.equal(stats.silenceRanges.length, 0);
});

test('analyzeAudio on pure silence reports one long gap', () => {
  const stats = analyzeAudio(new Float32Array(16_000 * 2), 16_000);
  assert.equal(stats.silenceRanges.length, 1);
  assert.ok(stats.onsetsSec.length === 0);
});

test('gradeStats recovers known colour statistics', () => {
  const frames = [solidFrame(200, 100, 50), solidFrame(200, 100, 50)];
  const stats = gradeStats(frames);
  assert.equal(stats.meanR, 200);
  assert.equal(stats.meanG, 100);
  assert.equal(stats.meanB, 50);
  assert.equal(stats.warmth, 150);
  assert.equal(stats.contrast, 0); // flat frame => no variance
  assert.ok(stats.saturation > 0.7);
});

test('representativeTimes picks the midpoint of the longest shots', () => {
  // Cuts at 2 and 3 seconds: shots of 2s, 1s, 7s. Longest shot midpoint = 6.5s.
  const times = representativeTimes([2, 3], 10, 1);
  assert.deepEqual(times, [6.5]);
  const many = representativeTimes([2, 3], 10, 8);
  assert.equal(many.length, 3);
  assert.deepEqual(many, [...many].sort((a, b) => a - b));
});

test('representativeTimes falls back to the middle of a single-shot clip', () => {
  assert.deepEqual(representativeTimes([], 4), [2]);
});

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modaya-measure-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('real media: measurement finds hard cuts at the right times', async () => {
  // Three solid-colour shots of 1s each, cut together. Detection should land
  // within one sampling interval (125ms) of the true boundaries.
  const clipA = join(dir, 'a.mp4');
  const clipB = join(dir, 'b.mp4');
  const clipC = join(dir, 'c.mp4');
  const joined = join(dir, 'joined.mp4');

  const make = (color: string, out: string) =>
    execFileAsync(ffmpegPath(), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=30:duration=1`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      out,
    ]);

  await make('red', clipA);
  await make('blue', clipB);
  await make('green', clipC);
  await execFileAsync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', clipA, '-i', clipB, '-i', clipC,
    '-filter_complex', '[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    joined,
  ]);

  const outcome = await analyzeMedia({
    filePath: joined,
    filename: 'joined.mp4',
    includeModel: false,
  });

  const cuts = outcome.measured.cuts.cutTimesSec;
  assert.equal(cuts.length, 2, `expected 2 cuts, got ${JSON.stringify(cuts)}`);
  assert.ok(Math.abs(cuts[0] - 1) <= SAMPLE_FPS ** -1, `first cut at ${cuts[0]}`);
  assert.ok(Math.abs(cuts[1] - 2) <= SAMPLE_FPS ** -1, `second cut at ${cuts[1]}`);

  assert.equal(outcome.measured.shots.count, 3);
  assert.ok(Math.abs(outcome.measured.shots.medianSec - 1) < 0.2);

  // No model requested => the layer is explicitly absent, not invented.
  assert.equal(outcome.model, null);
  assert.equal(outcome.modelStatus, 'skipped_no_key');

  // The measured layer records its own precision instead of implying more.
  assert.equal(outcome.measured.cutResolutionSec, 0.125);
  assert.equal(outcome.measured.media.width, 320);
});

test('readMeasured tolerates profiles written by older builds', () => {
  // A version-1 profile: no schemaVersion, no active-loudness fields.
  const legacy = {
    source: 'measured',
    durationSec: 12,
    sampledFps: 8,
    cutResolutionSec: 0.125,
    cuts: { cutTimesSec: [1, 2], resolutionSec: 0.125, threshold: 6, meanFrameDiff: 1, p95FrameDiff: 4 },
    shots: { count: 3, meanSec: 4, medianSec: 4, minSec: 1, maxSec: 9, stdevSec: 3 },
    audio: {
      meanRmsDb: -30,
      peakRmsDb: -10,
      silenceRanges: [],
      silenceRatio: 0,
      onsetsSec: [],
      onsetsPerMinute: 0,
      windowSec: 0.025,
      hopSec: 0.01,
      silenceThresholdDb: -45,
    },
    grade: { meanR: 1, meanG: 2, meanB: 3, meanLuma: 4, contrast: 5, saturation: 0.5, warmth: -2 },
    media: { width: 640, height: 360, fps: 30, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac' },
  };

  const result = readMeasured(legacy);
  assert.equal(result.stale, true, 'legacy profile should be flagged stale');
  assert.ok(result.missingFields.includes('audio.activeMeanRmsDb'));
  assert.ok(result.missingFields.includes('cuts.medianFrameDiff'));
  // Nothing is invented to fill the gap.
  assert.equal(result.measured.audio.activeMeanRmsDb, undefined);

  const current = readMeasured({
    ...legacy,
    schemaVersion: 2,
    cuts: { ...legacy.cuts, medianFrameDiff: 0, robustSigma: 0 },
    audio: { ...legacy.audio, activeMeanRmsDb: -21, activeRatio: 0.46 },
  });
  assert.equal(current.stale, false);
  assert.deepEqual(current.missingFields, []);
});
