import "server-only";
import { spawn } from "node:child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegInstaller.path;
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeInstaller.path;

export function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
    const t = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 20 * 60 * 1000);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function ffmpeg(args: string[], timeoutMs?: number) {
  const r = await run(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], { timeoutMs });
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}):\n${r.stderr.slice(-4000)}`);
  return r;
}

export type Probe = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  raw: unknown;
};

export async function probe(file: string): Promise<Probe> {
  const r = await run(FFPROBE, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.slice(-2000)}`);
  const json = JSON.parse(r.stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const rate = String(v?.avg_frame_rate || v?.r_frame_rate || "0/1");
  const [num, den] = rate.split("/").map(Number);
  const fps = den ? num / den : 0;
  const duration =
    Number(json.format?.duration) ||
    Number((v?.duration as string) ?? 0) ||
    0;

  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    fps: Number.isFinite(fps) ? Number(fps.toFixed(3)) : 0,
    hasAudio: Boolean(a),
    videoCodec: (v?.codec_name as string) ?? null,
    audioCodec: (a?.codec_name as string) ?? null,
    raw: json,
  };
}
