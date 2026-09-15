import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from '../src/lib/ffmpeg/binaries.ts';
import { analyzeMedia } from '../src/lib/style/analyze.ts';
import { describeFrames, visionAvailable } from '../src/lib/style/llm.ts';
import { extractJsonObject, timestampLikeStrings } from '../src/lib/style/prompt.ts';

const execFileAsync = promisify(execFile);

let server: Server;
let baseUrl: string;
let dir: string;
let samplePath: string;
let nextResponse = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'modaya-vision-'));
  samplePath = join(dir, 'sample.mp4');
  await execFileAsync(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    samplePath,
  ]);

  // Stand-in for an OpenAI-compatible endpoint: records the request, returns a
  // canned completion. Lets us exercise the real validation path.
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      (server as Server & { lastBody?: string }).lastBody = body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: nextResponse } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'object' && address) baseUrl = `http://127.0.0.1:${address.port}`;

  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.MODAYA_VISION_PROVIDER = 'openai';
  process.env.MODAYA_VISION_MODEL = 'stub-vision';
});

after(async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.MODAYA_VISION_PROVIDER;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

test('visionAvailable reflects whether a key is configured', () => {
  assert.equal(visionAvailable(), true);
});

test('extractJsonObject tolerates prose and code fences', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('Here you go: {"a": {"b": 2}} hope that helps'), { a: { b: 2 } });
  assert.equal(extractJsonObject('no json here'), null);
});

test('timestampLikeStrings flags time-shaped prose', () => {
  assert.ok(timestampLikeStrings({ pacing: 'cuts every 2.5s' }).length === 1);
  assert.ok(timestampLikeStrings({ pacing: 'cuts at 00:03' }).length === 1);
  assert.equal(timestampLikeStrings({ pacing: 'fast, punchy editing' }).length, 0);
});

test('describeFrames sends the frames to the provider and returns its text', async () => {
  nextResponse = JSON.stringify({ shotTypes: ['wide'], transitionStyle: 'hard cuts' });
  const response = await describeFrames({
    frames: [Buffer.from('fake-jpeg-bytes')],
    frameTimesSec: [0.5],
    transcript: null,
    filename: 'sample.mp4',
  });
  assert.equal(response.provider, 'openai');
  assert.match(response.text, /hard cuts/);

  const sent = JSON.parse((server as Server & { lastBody?: string }).lastBody ?? '{}');
  const content = sent.messages[1].content;
  assert.equal(content[0].type, 'text');
  assert.ok(content.some((part: { type: string }) => part.type === 'image_url'));
  assert.match(sent.messages[0].content, /Never state or estimate timestamps/);
});

test('model output is validated: unknown fields dropped, defaults applied', async () => {
  nextResponse = JSON.stringify({
    shotTypes: ['talking head', 'product close-up'],
    transitionStyle: 'hard cuts',
    captionPosition: 'bottom',
    captionStyle: 'bold sans, white with shadow',
    pacingDescription: 'cuts land on every beat, no pauses',
    hookStructure: 'opens on the result, then explains',
    notes: ['heavy grade'],
    // Fields the schema does not know about — must not survive.
    secretField: 'should be dropped',
    cutTimes: [1.2, 3.4],
    confidence: 0.93,
  });

  const outcome = await analyzeMedia({
    filePath: samplePath,
    filename: 'sample.mp4',
    includeModel: true,
  });

  assert.equal(outcome.modelStatus, 'ok');
  const model = outcome.model;
  assert.ok(model);
  assert.equal(model!.source, 'model_described');
  assert.equal(model!.provider, 'openai');
  assert.equal(model!.model, 'stub-vision');
  assert.deepEqual(model!.shotTypes, ['talking head', 'product close-up']);
  assert.equal(model!.captionPosition, 'bottom');
  assert.equal((model as unknown as Record<string, unknown>).secretField, undefined);
  assert.equal((model as unknown as Record<string, unknown>).cutTimes, undefined);
  assert.equal((model as unknown as Record<string, unknown>).confidence, undefined);

  // Timings come from the measured layer only.
  assert.ok(model!.frameCount > 0);
  assert.equal(model!.frameTimesSec.length, model!.frameCount);
  assert.ok(model!.frameTimesSec.every((t) => t >= 0 && t <= outcome.measured.durationSec));
  assert.deepEqual(
    model!.frameTimesSec,
    [...model!.frameTimesSec].sort((a, b) => a - b),
  );

  // The measured layer is untouched by any of this.
  assert.equal(outcome.measured.source, 'measured');
  assert.ok(outcome.measured.cuts.resolutionSec === 0.125);
});

test('time-like prose from the model is kept but flagged as prose', async () => {
  nextResponse = JSON.stringify({
    shotTypes: ['wide'],
    transitionStyle: 'cut at 00:02 into a dissolve',
    pacingDescription: 'roughly 3 second shots',
    captionPosition: 'top',
  });

  const outcome = await analyzeMedia({
    filePath: samplePath,
    filename: 'sample.mp4',
    includeModel: true,
  });

  assert.equal(outcome.modelStatus, 'ok');
  assert.ok(
    outcome.model!.caveats.some((caveat) => /time-like values/.test(caveat)),
    JSON.stringify(outcome.model!.caveats),
  );
  assert.ok(outcome.model!.caveats.some((caveat) => /No timestamps come from this layer/.test(caveat)));
});

test('a malformed model response fails that layer without losing the measurement', async () => {
  nextResponse = 'I am afraid I cannot do that.';

  const outcome = await analyzeMedia({
    filePath: samplePath,
    filename: 'sample.mp4',
    includeModel: true,
  });

  assert.equal(outcome.modelStatus, 'failed');
  assert.equal(outcome.model, null);
  assert.match(String(outcome.modelError), /not valid JSON/);
  // Measurement still stands on its own.
  assert.equal(outcome.measured.source, 'measured');
  assert.ok(outcome.measured.durationSec > 2.5);
});

test('a schema-violating subset is rejected rather than partially trusted', async () => {
  nextResponse = JSON.stringify({
    shotTypes: 'not an array',
    captionPosition: 'bottom',
  });

  const outcome = await analyzeMedia({
    filePath: samplePath,
    filename: 'sample.mp4',
    includeModel: true,
  });

  assert.equal(outcome.modelStatus, 'failed');
  assert.equal(outcome.model, null);
});

test('without includeModel the model layer is explicitly skipped', async () => {
  const outcome = await analyzeMedia({
    filePath: samplePath,
    filename: 'sample.mp4',
    includeModel: false,
  });
  assert.equal(outcome.model, null);
  assert.equal(outcome.modelStatus, 'skipped_no_key');
  assert.equal(outcome.modelError, null);
});
