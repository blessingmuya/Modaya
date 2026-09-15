import { anthropicConfig, openAiConfig, visionProvider } from '@/lib/env';
import { VISION_SYSTEM_PROMPT, visionUserPrompt } from './prompt';

export type VisionRequest = {
  frames: Buffer[];
  frameTimesSec: number[];
  transcript: string | null;
  filename: string;
};

export type VisionResponse = {
  provider: 'openai' | 'anthropic';
  model: string;
  text: string;
};

export class NoVisionProviderError extends Error {
  constructor() {
    super('No multimodal provider is configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
  }
}

export function visionAvailable(): boolean {
  return visionProvider() !== 'none';
}

/**
 * Two adapters, same contract. Everything that is provider-specific lives here
 * so the style pipeline does not care which one answered.
 */
export async function describeFrames(request: VisionRequest): Promise<VisionResponse> {
  const provider = visionProvider();
  if (provider === 'none') throw new NoVisionProviderError();
  const prompt = visionUserPrompt({
    frameCount: request.frames.length,
    transcript: request.transcript,
    filename: request.filename,
  });
  if (provider === 'anthropic') return callAnthropic(request, prompt);
  return callOpenAi(request, prompt);
}

async function callOpenAi(request: VisionRequest, prompt: string): Promise<VisionResponse> {
  const config = openAiConfig();
  if (!config.apiKey) throw new NoVisionProviderError();

  const content = [
    { type: 'text', text: prompt },
    ...request.frames.map((frame) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${frame.toString('base64')}`, detail: 'low' },
    })),
  ];

  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`vision provider returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('vision provider returned an empty response');
  return { provider: 'openai', model: config.model, text };
}

async function callAnthropic(request: VisionRequest, prompt: string): Promise<VisionResponse> {
  const config = anthropicConfig();
  if (!config.apiKey) throw new NoVisionProviderError();

  const content = [
    ...request.frames.map((frame) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg', data: frame.toString('base64') },
    })),
    { type: 'text' as const, text: prompt },
  ];

  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1200,
      temperature: 0,
      system: VISION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    throw new Error(`vision provider returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
  if (!text) throw new Error('vision provider returned an empty response');
  return { provider: 'anthropic', model: config.model, text };
}
