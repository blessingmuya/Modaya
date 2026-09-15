import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

/** Resolved once per process; overridable for hosts that ship their own build. */
export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || ffmpegInstaller.path;
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || ffprobeInstaller.path;
}
