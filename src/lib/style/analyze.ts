import { probeFile } from '@/lib/ffmpeg/probe';
import { extractEmbeddedTranscript, extractJpeg, sampleAudio, sampleFrames } from './extract';
import {
  analyzeAudio,
  detectCuts,
  frameDifferences,
  gradeStats,
  representativeTimes,
  shotStats,
  SAMPLE_FPS,
} from './measure';
import { describeFrames, visionAvailable } from './llm';
import { extractJsonObject, timestampLikeStrings } from './prompt';
import {
  MEASURED_SCHEMA_VERSION,
  modelLayerSchema,
  type MeasuredLayer,
  type ModelDescribedLayer,
  type ModelStatus,
} from './types';

export type AnalysisOutcome = {
  measured: MeasuredLayer;
  model: ModelDescribedLayer | null;
  modelStatus: ModelStatus;
  modelError: string | null;
};

export type AnalysisProgress = (stage: string) => void;

/**
 * The full analysis: measured layer always, model layer only when a provider is
 * configured and reachable. If the model step fails, the measured layer is still
 * returned and the failure is recorded — never silently substituted.
 */
export async function analyzeMedia(options: {
  filePath: string;
  filename: string;
  includeModel: boolean;
  onProgress?: AnalysisProgress;
}): Promise<AnalysisOutcome> {
  const { filePath, filename, includeModel, onProgress } = options;

  onProgress?.('probing');
  const probe = await probeFile(filePath);
  const durationSec = probe.durationSec ?? 0;

  onProgress?.('sampling');
  const video = probe.hasVideo ? await sampleFrames(filePath, SAMPLE_FPS) : { frames: [], fps: SAMPLE_FPS, width: 0, height: 0 };
  const audio = probe.hasAudio ? await sampleAudio(filePath) : new Float32Array(0);

  onProgress?.('measuring');
  const diffs = frameDifferences(video.frames);
  const cuts = detectCuts(diffs, { fps: SAMPLE_FPS });
  const shots = shotStats(cuts.cutTimesSec, durationSec);
  const audioStats = analyzeAudio(audio, 16_000);
  const grade = gradeStats(video.frames);

  const measured: MeasuredLayer = {
    source: 'measured',
    schemaVersion: MEASURED_SCHEMA_VERSION,
    durationSec: Number(durationSec.toFixed(3)),
    sampledFps: SAMPLE_FPS,
    cutResolutionSec: cuts.resolutionSec,
    cuts,
    shots,
    audio: audioStats,
    grade,
    media: {
      width: probe.width,
      height: probe.height,
      fps: probe.fps === null ? null : Number(probe.fps.toFixed(3)),
      hasAudio: probe.hasAudio,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
    },
  };

  if (!includeModel) {
    return { measured, model: null, modelStatus: 'skipped_no_key', modelError: null };
  }

  if (!visionAvailable()) {
    return {
      measured,
      model: null,
      modelStatus: 'skipped_no_key',
      modelError: 'No multimodal provider configured. Measurement layer only.',
    };
  }

  try {
    onProgress?.('model');
    const frameTimes = representativeTimes(cuts.cutTimesSec, durationSec, 8);
    const frames = await Promise.all(frameTimes.map((time) => extractJpeg(filePath, time)));
    const transcript = await extractEmbeddedTranscript(filePath);

    const response = await describeFrames({
      frames,
      frameTimesSec: frameTimes,
      transcript,
      filename,
    });

    const parsedRaw = extractJsonObject(response.text);
    if (!parsedRaw) throw new Error('model response was not valid JSON');

    // Strict: unknown fields are dropped, missing fields take declared defaults.
    const parsed = modelLayerSchema.safeParse(parsedRaw);
    if (!parsed.success) {
      throw new Error(
        `model response did not match the schema: ${parsed.error.issues
          .map((issue) => issue.path.join('.'))
          .join(', ')}`,
      );
    }

    const suspicious = timestampLikeStrings(parsedRaw);
    const caveats = [
      'Described from still frames, not the motion of the video.',
      'No timestamps come from this layer — all timing is measured.',
    ];
    if (!transcript) caveats.push('No transcript was available; audio content was not described.');
    if (suspicious.length > 0) {
      caveats.push(
        `The model mentioned time-like values (${suspicious.length} found); they are prose, not measurements.`,
      );
    }

    return {
      measured,
      model: {
        ...parsed.data,
        source: 'model_described',
        provider: response.provider,
        model: response.model,
        frameTimesSec: frameTimes,
        frameCount: frames.length,
        transcriptProvided: Boolean(transcript),
        caveats,
      },
      modelStatus: 'ok',
      modelError: null,
    };
  } catch (err) {
    return {
      measured,
      model: null,
      modelStatus: 'failed',
      modelError: (err as Error).message.slice(0, 500),
    };
  }
}
