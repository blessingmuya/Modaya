import type { RenderPlan } from './plan';
import { sec } from './plan';

/**
 * Builds the ffmpeg argument vector for a render plan.
 *
 * Determinism is the point: fixed encoder settings, no source metadata carried
 * over, bitexact flags, fixed pixel format and timebase, and filter chains that
 * depend only on the plan. Running this twice on the same inputs produces
 * identical output bytes (asserted in tests).
 *
 * Graph order: trim/normalise each clip → punch-in (zoompan) → concat →
 * grade (eq) → captions (drawtext) → encode.
 */
export function buildRenderArgs(plan: RenderPlan, outputPath: string): string[] {
  const filters: string[] = [];
  const concatLabels: string[] = [];
  // Resolved once by the plan, so the argument vector stays a pure function of it.
  const fontFile = plan.captionFont;

  plan.segments.forEach((segment, index) => {
    const { clip, durationSec } = segment;
    const input = segment.inputIndex;
    const videoLabel = `v${index}`;
    const audioLabel = `a${index}`;

    const videoChain = [
      `trim=start=${sec(segment.sourceInSec)}:end=${sec(segment.sourceOutSec)}`,
      'setpts=PTS-STARTPTS',
    ];
    if (segment.needsNormalize) {
      videoChain.push(
        `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease`,
        `pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2`,
        `fps=${plan.fps}`,
      );
    }

    // Only the segments inside a punch window are zoomed; the plan already split
    // the clip at those boundaries, so no time-conditional expression is needed.
    if (segment.punchScale !== null) {
      videoChain.push(zoomExpression(segment.punchScale, plan.width, plan.height, plan.fps));
    }

    videoChain.push('format=yuv420p');
    filters.push(`[${input}:v]${videoChain.join(',')}[${videoLabel}]`);

    if (segment.source.hasAudio) {
      const audioChain = [
        `atrim=start=${sec(segment.sourceInSec)}:end=${sec(segment.sourceOutSec)}`,
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
    `${concatLabels.join('')}concat=n=${plan.segments.length}:v=1:a=1[outv][outa]`,
  );

  // Grade: the same `eq` parameters the UI shows.
  const videoPost: string[] = [];
  const grade = plan.grade;
  const gradeParts = [
    grade.brightness !== undefined ? `brightness=${sec(grade.brightness)}` : null,
    grade.contrast !== undefined ? `contrast=${sec(grade.contrast)}` : null,
    grade.saturation !== undefined ? `saturation=${sec(grade.saturation)}` : null,
    grade.gamma !== undefined ? `gamma=${sec(grade.gamma)}` : null,
  ].filter((part): part is string => part !== null);

  if (gradeParts.length > 0) videoPost.push(`eq=${gradeParts.join(':')}`);

  // Captions last, so they sit on top of the grade.
  if (fontFile && plan.captions.length > 0) {
    for (const caption of plan.captions) {
      videoPost.push(
        [
          // The filter name joins its first option with `=`, the rest with `:`
          // (`drawtext:fontfile=...` is parsed as an unknown filter name).
          // expansion=none keeps `%` literal: with the default expansion mode a
          // caption like "50% off" makes drawtext fail its expansion and draw
          // nothing at all, silently.
          `drawtext=expansion=none:fontfile=${escapePath(fontFile)}`,
          `text=${escapeText(caption.text)}`,
          'fontcolor=white',
          'fontsize=h/22',
          'box=1',
          'boxcolor=black@0.55',
          'boxborderw=12',
          `x=(w-text_w)/2`,
          `y=${captionY(caption.position)}`,
          // End-exclusive: `between()` also lights up the frame that starts
          // exactly at endSec, which reads as a caption that lingers one frame.
          `enable=${escapeText(`gte(t,${caption.startSec})*lt(t,${caption.endSec})`)}`,
        ].join(':'),
      );
    }
  }

  const finalVideo = videoPost.length > 0 ? `[outv]${videoPost.join(',')}[finalv]` : null;

  const args = [
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
    finalVideo ? `${filters.join(';')};${finalVideo}` : filters.join(';'),
    '-map',
    finalVideo ? '[finalv]' : '[outv]',
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

  return args;
}

/**
 * zoompan holds a constant output size, so it is the right tool for punch-ins:
 * the zoom becomes a per-frame scale factor instead of a changing frame
 * geometry (a crop filter cannot change size mid-stream). Outside the punch
 * windows the factor is 1, i.e. a passthrough.
 */
export function zoomExpression(
  scale: number,
  width: number,
  height: number,
  fps: number,
): string {
  // A constant zoom for one segment. Deliberately no `if(between(...))` here:
  // the segments already encode when the zoom applies, and this build of ffmpeg
  // (N-47683, 2018) has no `in_time`/`it` variable for such a condition.
  return [
    `zoompan=z=${scale.toFixed(4)}`,
    `x='iw/2-(iw/zoom/2)'`,
    `y='ih/2-(ih/zoom/2)'`,
    'd=1',
    `s=${width}x${height}`,
    `fps=${fps}`,
  ].join(':');
}

function captionY(position: 'top' | 'center' | 'bottom'): string {
  switch (position) {
    case 'top':
      return 'h/12';
    case 'center':
      return '(h-text_h)/2';
    default:
      return 'h-text_h-h/12';
  }
}

function escapePath(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

/**
 * drawtext escaping, verified against ffmpeg rather than guessed at.
 *
 * Inside a single-quoted value the filter-graph parser does NOT treat `:`, `,`,
 * `%` or `[]` as specials, so escaping them is not just unnecessary — a
 * backslash-escaped colon makes drawtext render nothing at all (silently, with
 * exit code 0). A literal apostrophe inside a single-quoted value is the one
 * thing that genuinely breaks, so it is replaced with a typographic apostrophe.
 *
 * Verified cases: `It's 3:2, 50% faster [take 2]`, quotes, accents, em dashes.
 */
export function escapeText(value: string): string {
  const safe = value
    .replace(/[\r\n\t]+/g, ' ')     // strip newlines/tabs
    .replace(/'/g, '\u2019')            // literal apostrophe breaks drawtext
    .replace(/\s+/g, ' ')             // collapse runs of whitespace
    .trim()
    .slice(0, 180);
  return `'${safe}'`;
}
