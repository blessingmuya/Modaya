/**
 * The vision prompt. Note what it does *not* ask for: timestamps. Time only
 * ever comes from the measured layer, so the model is asked for description
 * only — and the response schema has nowhere to put a number that looks like a
 * timecode.
 */
export const VISION_SYSTEM_PROMPT = `You describe editing technique from still frames of a video.

Rules:
- Describe only what the frames show. If something is not visible, say "unknown".
- Never state or estimate timestamps, durations, or cut counts. You are not given
  timing information and any number you invent would be wrong.
- Answer with a single JSON object and nothing else.

JSON shape:
{
  "shotTypes": string[],          // e.g. ["wide establishing", "close-up talking head"]
  "transitionStyle": string,      // cuts vs dissolves vs speed ramps, as far as frames show
  "captionPosition": "none" | "top" | "center" | "bottom" | "unknown",
  "captionStyle": string,         // font weight, case, background, size impression
  "pacingDescription": string,    // one or two sentences, in words not numbers
  "hookStructure": string,        // how the opening frames try to hold attention
  "notes": string[]               // anything else worth flagging
}`;

export function visionUserPrompt(args: {
  frameCount: number;
  transcript: string | null;
  filename: string;
}): string {
  const lines = [
    `These are ${args.frameCount} still frames sampled from "${args.filename}".`,
    'They are shown in chronological order.',
  ];
  if (args.transcript) {
    lines.push(
      '',
      'The video also has a transcript (embedded subtitle track), included below. Use it only as context for what is being said:',
      '',
      args.transcript.slice(0, 6000),
    );
  } else {
    lines.push(
      '',
      'No transcript is available for this video (no subtitle track is present), so do not describe speech, wording, or audio.',
    );
  }
  return lines.join('\n');
}

/** Strip markdown fences and find the outermost JSON object in a response. */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, '```').split('```').join('\n');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Timestamps are allowed to appear only in measured fields. If a model response
 * contains timecode-shaped strings we keep the prose but flag it, rather than
 * quietly presenting a guess next to a measurement.
 */
export function timestampLikeStrings(value: unknown): string[] {
  const found: string[] = [];
  const pattern = /\b\d{1,2}:\d{2}(:\d{2})?\b|\b\d+(\.\d+)?\s?(s|sec|secs|seconds|ms)\b/i;

  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      if (pattern.test(node)) found.push(node.slice(0, 160));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item);
    }
  };

  walk(value);
  return found;
}
