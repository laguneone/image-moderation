import { Injectable } from '@nestjs/common';

export interface OpenRouterResult {
  content: string;
  modelId: string | null;
  requestId: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
}

export interface OpenRouterImage { buffer: Buffer; mimeType: string }
export interface OpenRouterOptions { timeoutMs?: number; maxTokens?: number | null; fallbackModelId?: string | null; generationParams?: Record<string, unknown> }

@Injectable()
export class OpenRouterClient {
  async analyze(model: string, prompt: string, image: Buffer, mimeType: string, jsonSchema?: Record<string, unknown>, options?: OpenRouterOptions): Promise<OpenRouterResult> {
    return this.analyzeImages(model, prompt, [{ buffer: image, mimeType }], jsonSchema, options);
  }

  async analyzeText(model: string, prompt: string, jsonSchema?: Record<string, unknown>, options?: OpenRouterOptions): Promise<OpenRouterResult> {
    return this.send(model, [{ type: 'text', text: prompt }], jsonSchema, options);
  }

  async analyzeImages(model: string, prompt: string, images: OpenRouterImage[], jsonSchema?: Record<string, unknown>, options?: OpenRouterOptions): Promise<OpenRouterResult> {
    if (images.length === 0 || images.length > 8) throw new Error('OpenRouter image request must contain between 1 and 8 images.');
    if (process.env.MODERATION_TEST_MODE === 'true' && !process.env.OPENROUTER_API_KEY) {
      return this.mockResult(model, prompt);
    }
    const requestContent: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}` } }))];
    return this.send(model, requestContent, jsonSchema, options);
  }

  private async send(model: string, content: Array<Record<string, unknown>>, jsonSchema?: Record<string, unknown>, options: OpenRouterOptions = {}): Promise<OpenRouterResult> {
    if (process.env.MODERATION_TEST_MODE === 'true' && !process.env.OPENROUTER_API_KEY) return this.mockResult(model, content[0] && typeof content[0].text === 'string' ? content[0].text : '');
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required unless MODERATION_TEST_MODE=true.');
    const started = Date.now();
    const response = await fetch(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'http://localhost:3000', 'X-Title': 'NSFW Filter' },
      body: JSON.stringify({
        model,
        ...(options.fallbackModelId ? { models: [model, options.fallbackModelId] } : {}),
        messages: [{ role: 'user', content }],
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...safeGenerationParams(options.generationParams),
        ...(jsonSchema ? { provider: { require_parameters: true } } : {}),
        ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: jsonSchema } } : {}),
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}): ${safeError(body)}`);
    if (typeof body !== 'object' || body === null) throw new Error('OpenRouter returned an invalid response.');
    const data = body as Record<string, unknown>;
    const choices = data.choices;
    if (!Array.isArray(choices) || typeof choices[0] !== 'object' || choices[0] === null) throw new Error('OpenRouter response has no choices.');
    const message = (choices[0] as Record<string, unknown>).message;
    const outputText = typeof message === 'object' && message !== null ? (message as Record<string, unknown>).content : null;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) throw new Error('OpenRouter response has no textual content.');
    const usage = typeof data.usage === 'object' && data.usage !== null ? data.usage as Record<string, unknown> : {};
    return {
      content: outputText,
      modelId: typeof data.model === 'string' ? data.model : null,
      requestId: typeof data.id === 'string' ? data.id : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
      inputTokens: finiteInteger(usage.prompt_tokens),
      outputTokens: finiteInteger(usage.completion_tokens),
      costUsd: typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null,
      latencyMs: Date.now() - started,
    };
  }

  private mockResult(model: string, prompt: string): OpenRouterResult {
    const marker = prompt.match(/\[stage:([a-z_]+)\]/u)?.[1];
    const answers: Record<string, unknown> = {
      initial_scene: { humans: { present: false, count: 0, categories: ['NO_HUMANS'] }, scene: { categories: ['INTERIOR_SCENE', 'FURNITURE'] }, objects: ['furniture'] },
      scene_decomposition: { scene_type: 'INTERIOR_SCENE', foreground: [], midground: [], background: [], persons: [], objects: [], artwork: [], text_regions: [], uncertainties: [] },
      relationships: { relations: [], sexualized_interaction: false, evidence: [] },
      composition: { visual_focus: 'interior objects', unusual_cropping: false, sexualized_focus: false, evidence: [] },
      context: { classification: 'NON_SEXUAL', explanation: 'Ordinary interior scene.', sexual_context: false },
      crops: { regions: [] },
      ocr: { text_regions: [], suspicious_text: false },
      arbitration: { recommendation: 'ALLOW', unresolved_questions: [], evidence: [] },
    };
    const content = model === 'nvidia/nemotron-3.5-content-safety'
      ? 'Safety: safe\nCategories: none'
      : marker && answers[marker] ? JSON.stringify(answers[marker]) : JSON.stringify(answers.initial_scene);
    return { content, modelId: model, requestId: 'explicit-test-mode', provider: 'test', inputTokens: null, outputTokens: null, costUsd: null, latencyMs: 0 };
  }
}

function safeGenerationParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  const supported = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'];
  const result: Record<string, unknown> = {};
  for (const key of supported) {
    const value = params[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeError(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'invalid error body';
  const error = (value as Record<string, unknown>).error;
  if (typeof error === 'object' && error !== null) {
    const details = error as Record<string, unknown>;
    const message = typeof details.message === 'string' ? details.message : 'provider error';
    const code = typeof details.code === 'string' || typeof details.code === 'number' ? ` [${details.code}]` : '';
    const metadata = typeof details.metadata === 'object' && details.metadata !== null ? details.metadata as Record<string, unknown> : {};
    const providerMessage = typeof metadata.raw === 'string' ? metadata.raw : typeof metadata.message === 'string' ? metadata.message : null;
    return `${message}${code}${providerMessage ? `; provider: ${providerMessage}` : ''}`.replace(/\s+/gu, ' ').slice(0, 700);
  }
  return 'provider error';
}
