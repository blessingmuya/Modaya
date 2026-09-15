import type { RenderPlan } from './plan';
import { sec } from './plan';

/**
 * Builds the ffmpeg argument vector for a render plan.
 *
 * Determinism is the point: fixed encoder settings, no source metadata carried
 * over, bitexact flags, fixed pixel format and timebase. Running this twice on
 * the same inputs produces identical output bytes (asserted in tests).
 */
export function buildRenderArgs(plan: RenderPlan, outputPath: string): string[] {
  const filters: string[] = [];
  const concatLabels: string[] = [];

  plan.clips.forEach((planned, index) => {
    const { clip, durationSec } = planned;
    const input = planned.inputIndex;
    const videoLabel = `v${index}`;
    const audioLabel = `a${index}`;

    const videoChain = [
      `trim=start=${sec(clip.inSec)}:end=${sec(clip.outSec)}`,
      'setpts=PTS-STARTPTS',
    ];
    if (planned.needsNormalize) {
      videoChain.push(
        `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease`,
        `pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2`,
        `fps=${plan.fps}`,
      );
    }
    videoChain.push('format=yuv420p');
    filters.push(`[${input}:v]${videoChain.join(',')}[${videoLabel}]`);

    if (planned.source.hasAudio) {
      const audioChain = [
        `atrim=start=${sec(clip.inSec)}:end=${sec(clip.outSec)}`,
        'asetpts=PTS-STARTPTS',
        // Pad with silence then cut back to the exact intended length, so every
        // segment's audio is at least as long as its video. `apad,atrim` is used
        // instead of `apad=whole_dur` because whole_dur only exists in newer
        // ffmpeg builds; this form works on any 4.x/5.x/6.x binary.
        'apad',
        `atrim=duration=${sec(durationSec)}`,
        'aresample=48000:async=1:first_pts=0',
        'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ];
      filters.push(`[${input}:a]${audioChain.join(',')}[${audioLabel}]`);
    } else {
      filters.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${sec(
          durationSec,
        )},asetpts=PTS-STARTPTS[${audioLabel}]`,
      );
    }

    concatLabels.push(`[${videoLabel}][${audioLabel}]`);
  });

  filters.push(
    `${concatLabels.join('')}concat=n=${plan.clips.length}:v=1:a=1[outv][outa]`,
  );

  return [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',

    ...plan.inputs.flatMap((source) => ['-i', source.filePath]),

    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',

    // Video: fixed encoder settings, no source metadata.
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(plan.fps),
    '-g',
    String(Math.max(1, Math.round(plan.fps * 2))),
    '-video_track_timescale',
    '90000',
    '-profile:v',
    'high',

    // Audio
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',

    // Reproducibility: drop metadata and encoder-version strings, stable mov.
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-movflags',
    '+faststart',
    '-shortest',

    outputPath,
  ];
}
