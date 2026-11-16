import { Injectable } from '@nestjs/common';

export interface OpenRouterResult {
  content: string;
  requestId: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
}

@Injectable()
export class OpenRouterClient {
  async analyze(model: string, prompt: string, image: Buffer, mimeType: string, jsonSchema?: Record<string, unknown>): Promise<OpenRouterResult> {
    if (process.env.MODERATION_TEST_MODE === 'true' && !process.env.OPENROUTER_API_KEY) {
      return {
        content: model === 'nvidia/nemotron-3.5-content-safety'
          ? 'Safety: safe\nCategories: none'
          : JSON.stringify({ humans: { present: false, count: 0, categories: ['NO_HUMANS'] }, scene: { categories: ['INTERIOR_SCENE', 'FURNITURE'] }, objects: ['furniture'] }),
        requestId: 'explicit-test-mode', provider: 'test', inputTokens: null, outputTokens: null, costUsd: null, latencyMs: 0,
      };
    }
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required unless MODERATION_TEST_MODE=true.');
    const started = Date.now();
    const response = await fetch(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'http://localhost:3000', 'X-Title': 'NSFW Filter' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
        ] }],
        ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: jsonSchema } } : {}),
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}): ${safeError(body)}`);
    if (typeof body !== 'object' || body === null) throw new Error('OpenRouter returned an invalid response.');
    const data = body as Record<string, unknown>;
    const choices = data.choices;
    if (!Array.isArray(choices) || typeof choices[0] !== 'object' || choices[0] === null) throw new Error('OpenRouter response has no choices.');
    const message = (choices[0] as Record<string, unknown>).message;
    const content = typeof message === 'object' && message !== null ? (message as Record<string, unknown>).content : null;
    if (typeof content !== 'string' || content.trim().length === 0) throw new Error('OpenRouter response has no textual content.');
    const usage = typeof data.usage === 'object' && data.usage !== null ? data.usage as Record<string, unknown> : {};
    return {
      content,
      requestId: typeof data.id === 'string' ? data.id : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
      inputTokens: finiteInteger(usage.prompt_tokens),
      outputTokens: finiteInteger(usage.completion_tokens),
      costUsd: typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null,
      latencyMs: Date.now() - started,
    };
  }
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeError(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'invalid error body';
  const error = (value as Record<string, unknown>).error;
  if (typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).message === 'string') {
    return ((error as Record<string, unknown>).message as string).slice(0, 300);
  }
  return 'provider error';
}
