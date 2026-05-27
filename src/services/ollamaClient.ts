import { AppError } from '../errors.ts';
import type { OllamaClientLike, OllamaInstalledModel, OllamaRunningModel, PrewarmResult } from '../types.ts';

interface OllamaTagsResponse {
  models?: OllamaInstalledModel[];
}

interface OllamaPsResponse {
  models?: OllamaRunningModel[];
}

interface OllamaVersionResponse {
  version?: string;
}

export class OllamaClient implements OllamaClientLike {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(baseUrl: string, defaultTimeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async getVersion(): Promise<string | null> {
    try {
      const response = await this.request<OllamaVersionResponse>('/api/version', { method: 'GET' });
      return typeof response.version === 'string' ? response.version : null;
    } catch (error: unknown) {
      if (error instanceof AppError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async listRunningModels(): Promise<OllamaRunningModel[]> {
    const response = await this.request<OllamaPsResponse>('/api/ps', { method: 'GET' });
    return Array.isArray(response.models) ? response.models : [];
  }

  async listInstalledModels(): Promise<OllamaInstalledModel[]> {
    const response = await this.request<OllamaTagsResponse>('/api/tags', { method: 'GET' });
    return Array.isArray(response.models) ? response.models : [];
  }

  async prewarmModel(model: string, keepAlive: string | number, timeoutMs = this.defaultTimeoutMs): Promise<PrewarmResult> {
    const response = await this.request<unknown>('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: keepAlive
      })
    }, timeoutMs);

    return { model, response };
  }

  private async request<T>(path: string, init: RequestInit, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal
      });

      const text = await response.text();
      const body = parseMaybeJson(text);

      if (!response.ok) {
        throw errorFromOllamaStatus(response.status, body, path);
      }

      return body as T;
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new AppError('OLLAMA_TIMEOUT', `Timed out talking to Ollama after ${timeoutMs}ms`, 504, {
          base_url: this.baseUrl,
          path
        });
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OLLAMA_UNAVAILABLE', 'Unable to connect to Ollama', 503, {
        base_url: this.baseUrl,
        path,
        cause: error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseMaybeJson(text: string): unknown {
  if (text.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function errorFromOllamaStatus(status: number, body: unknown, path: string): AppError {
  const message = extractOllamaMessage(body) ?? `Ollama returned HTTP ${status}`;

  if (status === 404) {
    return new AppError('OLLAMA_MODEL_NOT_FOUND', message, 404, { path, response: body });
  }

  if (status === 408 || status === 504) {
    return new AppError('OLLAMA_TIMEOUT', message, 504, { path, response: body });
  }

  return new AppError('OLLAMA_REQUEST_FAILED', message, status >= 400 && status < 600 ? status : 502, {
    path,
    response: body
  });
}

function extractOllamaMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string') {
      return record.error;
    }
    if (typeof record.message === 'string') {
      return record.message;
    }
    if (typeof record.status === 'string') {
      return record.status;
    }
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
