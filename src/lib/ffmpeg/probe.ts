import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffprobePath } from './binaries';

const execFileAsync = promisify(execFile);

export type MediaProbe = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  formatName: string | null;
  bitRate: number | null;
  sizeBytes: number | null;
  raw: unknown;
};

type ProbeStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    size?: string;
    bit_rate?: string;
    format_name?: string;
  };
};

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split('/').map(Number);
  if (!Number.isFinite(num)) return null;
  if (!den) return num;
  if (den === 0) return null;
  const value = num / den;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function probeFile(filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(
    ffprobePath(),
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout) as ProbeResult;
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  // Container duration is the most reliable; fall back to the video stream.
  const durationSec =
    parseNumber(parsed.format?.duration) ?? parseNumber(video?.duration) ?? null;

  return {
    durationSec,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseRate(video?.r_frame_rate) ?? parseRate(video?.avg_frame_rate),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: parseNumber(audio?.sample_rate),
    audioChannels: audio?.channels ?? null,
    formatName: parsed.format?.format_name ?? null,
    bitRate: parseNumber(parsed.format?.bit_rate),
    sizeBytes: parseNumber(parsed.format?.size),
    raw: parsed,
  };
}

export type ProbeStreamInfo = {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSec: number | null;
};

/** Probe a file already on disk in the worker's scratch space. */
export async function probeForRender(filePath: string): Promise<ProbeStreamInfo> {
  const probe = await probeFile(filePath);
  return {
    hasVideo: probe.hasVideo,
    hasAudio: probe.hasAudio,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    durationSec: probe.durationSec,
  };
}
