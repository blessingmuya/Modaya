import { spawn } from 'node:child_process';
import { ffmpegPath } from '@/lib/ffmpeg/binaries';
import { buildRenderArgs } from './ffmpeg-args';
import { planDuration, planRender, type RenderPlan, type RenderSource } from './plan';
import type { TimelineSpec } from '@/lib/timeline/spec';

export class RenderError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export type RenderOptions = {
  spec: TimelineSpec;
  sources: RenderSource[];
  outputPath: string;
  onProgress?: (fraction: number) => void;
};

export type RenderResult = {
  outputPath: string;
  durationSec: number;
  wallMs: number;
  plan: RenderPlan;
  command: string[];
};

export { planRender, planDuration };
export type { RenderPlan, RenderSource };

/**
 * Runs the render. Progress comes from ffmpeg's own `-progress` stream, so the
 * number in the UI is the encoder's position, not an animation.
 */
export async function renderTimeline(options: RenderOptions): Promise<RenderResult> {
  const plan = planRender(options.spec, options.sources);
  const args = buildRenderArgs(plan, options.outputPath);
  const expected = planDuration(plan);
  const startedAt = Date.now();

  let lastReported = -1;
  let stderrTail = '';

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!options.onProgress || expected <= 0) return;
      for (const line of chunk.split('\n')) {
        const match = /^out_time_ms=(\d+)$/.exec(line.trim());
        if (!match) continue;
        const seconds = Number(match[1]) / 1_000_000;
        const fraction = Math.max(0, Math.min(0.999, seconds / expected));
        const bucket = Math.floor(fraction * 100);
        if (bucket !== lastReported) {
          lastReported = bucket;
          options.onProgress(fraction);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
    });

    child.on('error', (err) => reject(new RenderError(`Could not start ffmpeg: ${err.message}`, '')));
    child.on('close', (code) => {
      if (code === 0) {
        options.onProgress?.(1);
        resolve();
      } else {
        reject(new RenderError(`ffmpeg exited with code ${code}`, stderrTail));
      }
    });
  });

  return {
    outputPath: options.outputPath,
    durationSec: expected,
    wallMs: Date.now() - startedAt,
    plan,
    command: [ffmpegPath(), ...args],
  };
}
