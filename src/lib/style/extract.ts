import { spawn } from 'node:child_process';
import { ffmpegPath } from '@/lib/ffmpeg/binaries';
import {
  AUDIO_SAMPLE_RATE,
  FRAME_BYTES,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  SAMPLE_FPS,
} from './measure';

/**
 * Pulls the raw material for measurement out of a media file using ffmpeg:
 * tiny RGB frames (for cuts and colour) and mono PCM (for loudness and onsets).
 * Everything is piped, nothing is written to disk.
 */
export type SampledVideo = {
  frames: Uint8Array[];
  fps: number;
  width: number;
  height: number;
};

export async function sampleFrames(filePath: string, fps = SAMPLE_FPS): Promise<SampledVideo> {
  const args = [
    '-v',
    'error',
    '-nostdin',
    '-i',
    filePath,
    '-an',
    '-vf',
    `fps=${fps},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ];

  const buffer = await collect(ffmpegPath(), args);
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + FRAME_BYTES <= buffer.length; offset += FRAME_BYTES) {
    frames.push(new Uint8Array(buffer.subarray(offset, offset + FRAME_BYTES)));
  }
  return { frames, fps, width: FRAME_WIDTH, height: FRAME_HEIGHT };
}

export async function sampleAudio(
  filePath: string,
  sampleRate = AUDIO_SAMPLE_RATE,
): Promise<Float32Array> {
  const args = [
    '-v',
    'error',
    '-nostdin',
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-f',
    'f32le',
    '-',
  ];

  const buffer = await collect(ffmpegPath(), args);
  const usable = buffer.length - (buffer.length % 4);
  const view = new Float32Array(usable / 4);
  for (let i = 0; i < view.length; i += 1) view[i] = buffer.readFloatLE(i * 4);
  return view;
}

/** Extract a single frame at a timestamp as JPEG bytes (for the vision layer). */
export async function extractJpeg(filePath: string, atSec: number, width = 512): Promise<Buffer> {
  const args = [
    '-v',
    'error',
    '-nostdin',
    '-ss',
    atSec.toFixed(3),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:-2`,
    '-f',
    'image2pipe',
    '-c:v',
    'mjpeg',
    '-',
  ];
  return collect(ffmpegPath(), args);
}

/** Embedded subtitle tracks are a real transcript source; MP4s usually have none. */
export async function extractEmbeddedTranscript(filePath: string): Promise<string | null> {
  const args = [
    '-v',
    'error',
    '-nostdin',
    '-i',
    filePath,
    '-map',
    '0:s:0?',
    '-f',
    'srt',
    '-',
  ];
  try {
    const buffer = await collect(ffmpegPath(), args);
    const text = buffer.toString('utf8').replace(/\r/g, '').trim();
    return text.length > 0 ? text.slice(0, 12_000) : null;
  } catch {
    return null;
  }
}

function collect(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)));
    child.on('close', (code) => {
      // A media file without an audio/video track makes ffmpeg exit non-zero
      // with no output; callers treat empty output as "nothing to measure".
      if (code === 0 || chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-300)}`));
    });
  });
}
