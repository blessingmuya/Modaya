import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from '../src/lib/ffmpeg/binaries.ts';
import { probeFile } from '../src/lib/ffmpeg/probe.ts';
import { planRender } from '../src/lib/render/plan.ts';
import { buildRenderArgs } from '../src/lib/render/ffmpeg-args.ts';
import { renderTimeline } from '../src/lib/render/run.ts';
import type { TimelineSpec } from '../src/lib/timeline/spec.ts';

const execFileAsync = promisify(execFile);
const ASSET = '22222222-2222-4222-8222-222222222222';

let dir: string;
let sourcePath: string;
let sourceProbe: Awaited<ReturnType<typeof probeFile>>;

async function sha256(path: string) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modaya-render-'));
  sourcePath = join(dir, 'source.mp4');
  // 4 seconds, 320x240, 30fps, with an audio track.
  await execFileAsync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    sourcePath,
  ]);
  sourceProbe = await probeFile(sourcePath);
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sources() {
  return [
    {
      assetId: ASSET,
      filePath: sourcePath,
      width: sourceProbe.width,
      height: sourceProbe.height,
      fps: sourceProbe.fps,
      hasAudio: sourceProbe.hasAudio,
    },
  ];
}

const cutSpec: TimelineSpec = {
  version: 1,
  clips: [
    { id: 'a', assetId: ASSET, inSec: 0.5, outSec: 1.5 },
    { id: 'b', assetId: ASSET, inSec: 2.5, outSec: 3.5 },
  ],
};

test('probeFile reports duration, dimensions and audio presence', () => {
  assert.ok(sourceProbe.durationSec !== null);
  assert.ok(sourceProbe.durationSec > 3.5 && sourceProbe.durationSec < 4.5);
  assert.equal(sourceProbe.width, 320);
  assert.equal(sourceProbe.height, 240);
  assert.equal(sourceProbe.hasAudio, true);
  assert.equal(sourceProbe.hasVideo, true);
});

test('planRender maps clips to inputs and computes output duration', () => {
  const plan = planRender(cutSpec, sources());
  assert.equal(plan.inputs.length, 1);
  assert.equal(plan.clips.length, 2);
  assert.equal(plan.outputDurationSec, 2);
  assert.equal(plan.width, 320);
  assert.equal(plan.fps, 30);
});

test('planRender refuses a timeline that references missing media', () => {
  assert.throws(
    () => planRender({ version: 1, clips: [{ id: 'x', assetId: '33333333-3333-4333-8333-333333333333', inSec: 0, outSec: 1 }] }, sources()),
    /not available/,
  );
});

test('the same operation list produces byte-identical output twice', async () => {
  const first = join(dir, 'out-1.mp4');
  const second = join(dir, 'out-2.mp4');

  await renderTimeline({ spec: cutSpec, sources: sources(), outputPath: first });
  await renderTimeline({ spec: cutSpec, sources: sources(), outputPath: second });

  const [hashA, hashB] = await Promise.all([sha256(first), sha256(second)]);
  assert.equal(hashA, hashB, 'renders are not deterministic');

  const size = (await stat(first)).size;
  assert.ok(size > 0);
});

test('the exported file is shorter than the source and keeps both streams', async () => {
  const out = join(dir, 'cut.mp4');
  const result = await renderTimeline({ spec: cutSpec, sources: sources(), outputPath: out });
  const probe = await probeFile(out);

  assert.ok(result.durationSec === 2);
  assert.ok(probe.durationSec !== null);
  assert.ok(probe.durationSec > 1.8 && probe.durationSec < 2.2, `unexpected duration ${probe.durationSec}`);
  assert.ok(probe.durationSec !== null && sourceProbe.durationSec !== null);
  assert.ok(probe.durationSec < sourceProbe.durationSec);
  assert.equal(probe.hasVideo, true);
  assert.equal(probe.hasAudio, true);
  assert.equal(probe.width, 320);
});

const fullSpec: TimelineSpec = {
  version: 1,
  clips: [{ id: 'a', assetId: ASSET, inSec: 0, outSec: 4 }],
};

test('a single-clip spec at full length does not inflate the file', async () => {
  const out = join(dir, 'full.mp4');
  await renderTimeline({
    spec: fullSpec,
    sources: sources(),
    outputPath: out,
  });
  const probe = await probeFile(out);
  assert.ok(probe.durationSec !== null && probe.durationSec > 3.8 && probe.durationSec < 4.2);
});

const halfSpec: TimelineSpec = {
  version: 1,
  clips: [{ id: 'a', assetId: ASSET, inSec: 0, outSec: 1.5 }],
};

test('a source with no audio track still renders with a silent track', async () => {
  const silentSource = join(dir, 'silent.mp4');
  await execFileAsync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30',
    '-t', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-an',
    silentSource,
  ]);
  const probe = await probeFile(silentSource);
  assert.equal(probe.hasAudio, false);

  const out = join(dir, 'silent-out.mp4');
  await renderTimeline({
    spec: halfSpec,
    sources: [
      {
        assetId: ASSET,
        filePath: silentSource,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: false,
      },
    ],
    outputPath: out,
  });
  const outProbe = await probeFile(out);
  assert.equal(outProbe.hasVideo, true);
  assert.equal(outProbe.hasAudio, true);
});

test('buildRenderArgs is a pure function of the plan', () => {
  const plan = planRender(cutSpec, sources());
  const argsA = buildRenderArgs(plan, '/tmp/a.mp4');
  const argsB = buildRenderArgs(planRender(cutSpec, sources()), '/tmp/a.mp4');
  assert.deepEqual(argsA, argsB);
  assert.ok(argsA.includes('-map_metadata'));
  assert.ok(argsA.includes('+bitexact'));
});

test('progress reporting reaches 100% and stays monotonic', async () => {
  const out = join(dir, 'progress.mp4');
  const seen: number[] = [];
  await renderTimeline({
    spec: cutSpec,
    sources: sources(),
    outputPath: out,
    onProgress: (fraction) => seen.push(fraction),
  });
  assert.ok(seen.length > 0);
  assert.equal(seen[seen.length - 1], 1);
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], 'progress went backwards');
  }
});
