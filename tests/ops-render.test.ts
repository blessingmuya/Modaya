import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from '../src/lib/ffmpeg/binaries.ts';
import { probeFile } from '../src/lib/ffmpeg/probe.ts';
import { buildRenderArgs, escapeText, zoomExpression } from '../src/lib/render/ffmpeg-args.ts';
import { planDuration, planRender, type RenderSource } from '../src/lib/render/plan.ts';
import { renderTimeline } from '../src/lib/render/run.ts';
import type { TimelineSpec } from '../src/lib/timeline/spec.ts';

const execFileAsync = promisify(execFile);
const ASSET = '44444444-4444-4444-8444-444444444444';

let dir: string;
let sourcePath: string;
let source: RenderSource;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modaya-opsrender-'));
  sourcePath = join(dir, 'source.mp4');
  // 6 seconds of a moving pattern so framing changes are visible, with audio.
  await execFileAsync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    sourcePath,
  ]);
  const probe = await probeFile(sourcePath);
  source = {
    assetId: ASSET,
    filePath: sourcePath,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
  };
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Runs the real filter graph for a spec and writes one PNG per output frame.
 *
 * Comparing encoded files is the wrong instrument for "did this operation stay
 * inside its window": x264 rate control looks ahead across the whole stream, so a
 * changed segment perturbs neighbouring frames by ~0.5% SSIM even when the pixels
 * are identical. Comparing pre-encode frames is exact.
 */
async function filterFrames(spec: TimelineSpec, label: string): Promise<string[]> {
  const plan = planRender(spec, [source]);
  const args = buildRenderArgs(plan, join(dir, 'unused.mp4'));
  const graph = args[args.indexOf('-filter_complex') + 1];
  const videoLabel = args[args.indexOf('-map') + 1];

  const outDir = join(dir, label);
  await mkdir(outDir, { recursive: true });
  await execFileAsync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...plan.inputs.flatMap((input) => ['-i', input.filePath]),
    '-filter_complex', graph,
    '-map', videoLabel,
    '-f', 'image2', join(outDir, 'f-%05d.png'),
    // The audio pad still has to be consumed, or ffmpeg rejects the graph.
    '-map', '[outa]', '-f', 'null', '-',
  ]);

  return (await readdir(outDir)).sort().map((name) => join(outDir, name));
}

async function frameHashes(frames: string[]): Promise<string[]> {
  return Promise.all(
    frames.map(async (frame) => createHash('sha256').update(await readFile(frame)).digest('hex')),
  );
}

/** 1-based frame numbers that differ between two runs. */
async function differingFrames(specA: TimelineSpec, specB: TimelineSpec, label: string): Promise<number[]> {
  const [a, b] = await Promise.all([filterFrames(specA, `${label}-a`), filterFrames(specB, `${label}-b`)]);
  assert.equal(a.length, b.length, 'the two runs produced different frame counts');
  const [hashA, hashB] = await Promise.all([frameHashes(a), frameHashes(b)]);
  return hashA.map((hash, index) => (hash === hashB[index] ? 0 : index + 1)).filter((n) => n > 0);
}

/** Frame numbers covering [startSec, endSec) at a given frame rate. */
function framesFor(startSec: number, endSec: number, fps: number): number[] {
  const first = Math.round(startSec * fps) + 1;
  const last = Math.round(endSec * fps);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

const baseSpec: TimelineSpec = {
  version: 1,
  clips: [{ id: 'a', assetId: ASSET, inSec: 0, outSec: 4 }],
};

test('escapeText leaves a quoted value ffmpeg can draw', () => {
  const escaped = escapeText("It's 3:2, 50% faster [take 2]");
  assert.ok(escaped.startsWith("'") && escaped.endsWith("'"));
  // A literal apostrophe breaks drawtext, so it is replaced...
  assert.ok(!escaped.includes("'s"));
  // ...and nothing is backslash-escaped: `\:` makes drawtext draw nothing at all.
  assert.ok(!escaped.includes('\\:'));
  assert.ok(escaped.includes('50%'));
});

test('escapeText collapses newlines and caps length', () => {
  const escaped = escapeText(`line one\nline two\t${'x'.repeat(400)}`);
  assert.ok(!escaped.includes('\n'));
  assert.ok(escaped.length < 200);
});

test('zoomExpression emits a constant zoom, never a time conditional', () => {
  const expression = zoomExpression(1.3, 640, 360, 30);
  assert.match(expression, /^zoompan=z=1\.3000/);
  assert.match(expression, /x='iw\/2-\(iw\/zoom\/2\)'/);
  assert.match(expression, /s=640x360/);
  assert.match(expression, /fps=30/);
  // This ffmpeg build has no in_time/it variable, and a conditional would also
  // resample the frames outside the window.
  assert.equal((expression.match(/if\(/g) ?? []).length, 0);
});

test('the plan splits a clip at punch-in boundaries and keeps its duration', () => {
  const plan = planRender(
    { ...baseSpec, punchIns: [{ id: 'p1', startSec: 1, endSec: 2, scale: 1.4 }] },
    [source],
  );

  assert.equal(plan.segments.length, 3, 'clip should split into before / punch / after');
  assert.deepEqual(
    plan.segments.map((s) => [s.sourceInSec, s.sourceOutSec, s.punchScale]),
    [
      [0, 1, null],
      [1, 2, 1.4],
      [2, 4, null],
    ],
  );
  const sum = plan.segments.reduce((total, s) => total + s.durationSec, 0);
  assert.ok(Math.abs(sum - planDuration(plan)) < 0.001, `${sum} vs ${planDuration(plan)}`);
});

test('grade changes every frame of the render', async () => {
  const changed = await differingFrames(
    baseSpec,
    { ...baseSpec, grade: { contrast: 1.6, saturation: 1.7, brightness: 0.12 } },
    'grade',
  );
  assert.equal(changed.length, 120, 'grade should affect the whole timeline');

  const graded = await renderTimeline({
    spec: { ...baseSpec, grade: { contrast: 1.6, saturation: 1.7, brightness: 0.12 } },
    sources: [source],
    outputPath: join(dir, 'graded.mp4'),
  });
  const probe = await probeFile(graded.outputPath);
  assert.ok(probe.durationSec !== null && probe.durationSec > 3.8 && probe.durationSec < 4.2);
});

test('punch-in changes the framing inside its window and nothing else', async () => {
  const changed = await differingFrames(
    baseSpec,
    { ...baseSpec, punchIns: [{ id: 'p1', startSec: 1, endSec: 2, scale: 1.5 }] },
    'punch',
  );
  assert.deepEqual(
    changed,
    framesFor(1, 2, source.fps ?? 30),
    'the zoom leaked outside its window, or missed part of it',
  );
});

test('a punch-in leaves the audio untouched and in sync', async () => {
  const plain = join(dir, 'audio-plain.mp4');
  const punched = join(dir, 'audio-punched.mp4');
  await renderTimeline({ spec: baseSpec, sources: [source], outputPath: plain });
  await renderTimeline({
    spec: { ...baseSpec, punchIns: [{ id: 'p1', startSec: 1, endSec: 2, scale: 1.5 }] },
    sources: [source],
    outputPath: punched,
  });

  const pcm = async (file: string) => {
    const { stdout } = await execFileAsync(ffmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-map', '0:a', '-f', 's16le', '-ac', '2', '-ar', '48000', 'pipe:1',
    ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    return createHash('sha256').update(stdout).digest('hex');
  };

  assert.equal(await pcm(plain), await pcm(punched), 'punch-in shifted the audio');
});

test('captions are drawn inside their window and nowhere else', async () => {
  const captionSpec: TimelineSpec = {
    ...baseSpec,
    captions: [
      { id: 'c1', startSec: 1.5, endSec: 2.5, text: "It's 3:2, 50% faster [take 2]", position: 'bottom' },
    ],
  };

  const plan = planRender(captionSpec, [source]);
  assert.ok(plan.captionFont, 'no font found on this host; captions cannot be verified');
  assert.deepEqual(plan.warnings, []);

  const changed = await differingFrames(baseSpec, captionSpec, 'caption');
  assert.ok(changed.length > 0, 'no caption was drawn at all');
  const window = new Set(framesFor(1.5, 2.5, source.fps ?? 30));
  const outside = changed.filter((frame) => !window.has(frame));
  assert.deepEqual(outside, [], `captions appeared outside their window: ${outside.join(',')}`);
});

test('captions with hostile text still render something', async () => {
  // Percent, colon, comma, brackets and a backslash: every one of these silently
  // produces an empty caption if escaped the wrong way.
  const captionSpec: TimelineSpec = {
    ...baseSpec,
    captions: [{ id: 'c1', startSec: 0, endSec: 1, text: "50% done: it's [fine]\\ok", position: 'bottom' }],
  };
  const changed = await differingFrames(baseSpec, captionSpec, 'caption-hostile');
  assert.ok(changed.length > 0, 'hostile caption text rendered nothing');
});

test('a render with grade, punch-in and captions together is deterministic', async () => {
  const spec: TimelineSpec = {
    version: 1,
    clips: [
      { id: 'a', assetId: ASSET, inSec: 0, outSec: 1.5 },
      { id: 'b', assetId: ASSET, inSec: 2.5, outSec: 4 },
    ],
    grade: { contrast: 1.25, saturation: 1.1 },
    punchIns: [{ id: 'p1', startSec: 0.5, endSec: 1.2, scale: 1.25 }],
    captions: [{ id: 'c1', startSec: 1, endSec: 2, text: 'Deterministic caption', position: 'top' }],
  };

  const first = join(dir, 'combo-1.mp4');
  const second = join(dir, 'combo-2.mp4');
  await renderTimeline({ spec, sources: [source], outputPath: first });
  await renderTimeline({ spec, sources: [source], outputPath: second });

  const [left, right] = await Promise.all([readFile(first), readFile(second)]);
  assert.equal(
    createHash('sha256').update(left).digest('hex'),
    createHash('sha256').update(right).digest('hex'),
    'full op vocabulary render is not deterministic',
  );

  const probe = await probeFile(first);
  assert.ok(probe.durationSec !== null && probe.durationSec > 2.8 && probe.durationSec < 3.2);
  assert.equal(probe.width, 640);
});

test('captions are skipped with a warning when the font is unusable', async () => {
  const spec: TimelineSpec = {
    ...baseSpec,
    captions: [{ id: 'c1', startSec: 0, endSec: 1, text: 'no font here', position: 'bottom' }],
  };

  // Explicitly broken font: the plan must not quietly pick a different one.
  const broken = planRender(spec, [source], { captionFont: '/nonexistent/font.ttf' });
  assert.equal(broken.captions.length, 0);
  assert.equal(broken.captionFont, null);
  assert.ok(
    broken.warnings.some((warning) => /font/i.test(warning)),
    JSON.stringify(broken.warnings),
  );
  assert.ok(!buildRenderArgs(broken, join(dir, 'never.mp4')).join(' ').includes('drawtext'));

  // No font at all: same promise, generic message.
  const none = planRender(spec, [source], { captionFont: null });
  assert.equal(none.captions.length, 0);
  assert.ok(none.warnings.some((warning) => /font/i.test(warning)), JSON.stringify(none.warnings));

  // And with the font this host really has, the caption survives planning.
  const real = planRender(spec, [source]);
  if (real.captionFont !== null && existsSync(real.captionFont)) {
    assert.equal(real.captions.length, 1);
    const graph = buildRenderArgs(real, join(dir, 'never.mp4')).join(' ');
    assert.match(graph, /drawtext=.*fontfile=/);
    assert.ok(graph.includes('expansion=none'), 'expansion must be off or `%` breaks captions');
  }
});
