import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { ConfigStore } from './config/store.ts';
import { AppError, toErrorPayload, statusCodeForError } from './errors.ts';
import type { Logger } from './logger.ts';
import { buildOpenApiDocument } from './openapi.ts';
import { toLegacyGpu } from './services/gpuService.ts';
import type { AppConfig, GpuServiceLike, OllamaChatMessage, OllamaClientLike, OllamaImageGenerateOptions, OllamaRunningModel, RuntimeConfig } from './types.ts';
import { validateAssistantChatRequest, validateModelLoadRequest, validateModelName } from './utils/validation.ts';
import { isDefaultModelLoaded } from './utils/modelState.ts';
import { APPLICATION_VERSION, RUNTIME_NAME, SERVICE_NAME } from './version.ts';

export interface AppDependencies {
  runtimeConfig: RuntimeConfig;
  configStore: ConfigStore;
  ollamaClient: OllamaClientLike;
  gpuService: GpuServiceLike;
  logger: Logger;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createRequestHandler(dependencies: AppDependencies): RequestHandler {
  return async (request, response) => {
    const start = Date.now();
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    try {
      await routeRequest(method, url, request, response, dependencies);
    } catch (error: unknown) {
      dependencies.logger.error({ err: error, method, path: url.pathname }, 'Unhandled request error');
      sendJson(response, statusCodeForError(error), toErrorPayload(error));
    } finally {
      dependencies.logger.info({
        method,
        path: url.pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - start
      }, 'request completed');
    }
  };
}

async function routeRequest(method: string, url: URL, request: IncomingMessage, response: ServerResponse, dependencies: AppDependencies): Promise<void> {
  const { configStore, gpuService, ollamaClient, runtimeConfig, logger } = dependencies;
  const pathName = url.pathname;

  if (method === 'GET' && pathName === '/') {
    sendText(response, 200, renderPortalHtml(), 'text/html; charset=utf-8');
    return;
  }

  if (method === 'GET' && pathName === '/assets/app.css') {
    sendText(response, 200, await readPublicAsset('app.css', logger), 'text/css; charset=utf-8');
    return;
  }

  if (method === 'GET' && pathName === '/assets/app.js') {
    sendText(response, 200, await readPublicAsset('app.js', logger), 'application/javascript; charset=utf-8');
    return;
  }

  if (method === 'GET' && pathName === '/openapi.json') {
    sendJson(response, 200, buildOpenApiDocument());
    return;
  }

  if (method === 'GET' && pathName === '/health') {
    await handleHealth(response, configStore, ollamaClient, runtimeConfig);
    return;
  }

  if (method === 'GET' && pathName === '/api/capabilities') {
    await handleCapabilities(response, configStore, ollamaClient, runtimeConfig, logger);
    return;
  }

  if (method === 'POST' && pathName === '/api/assistant/chat') {
    await handleAssistantChat(request, response, ollamaClient, runtimeConfig);
    return;
  }

  if (method === 'POST' && pathName === '/api/images/generate') {
    await handleImageGeneration(request, response, configStore, ollamaClient, runtimeConfig, logger);
    return;
  }

  if (method === 'GET' && pathName === '/gpu') {
    try {
      const gpus = await gpuService.queryGpus();
      if (gpus.length === 0) {
        sendJson(response, 503, { ok: false, error: { code: 'NO_GPUS_DETECTED', message: 'No NVIDIA GPUs detected' } });
        return;
      }
      sendJson(response, 200, { ok: true, gpu: toLegacyGpu(gpus[0]!) });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error, 503), toErrorPayload(error, 'GPU_TELEMETRY_FAILED'));
    }
    return;
  }

  if (method === 'GET' && pathName === '/gpus') {
    try {
      const gpus = await gpuService.queryGpus();
      sendJson(response, 200, { ok: true, gpus });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error, 503), toErrorPayload(error, 'GPU_TELEMETRY_FAILED'));
    }
    return;
  }

  if (method === 'GET' && pathName === '/models/running') {
    try {
      const models = await ollamaClient.listRunningModels();
      sendJson(response, 200, { ok: true, models });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error, 503), toErrorPayload(error));
    }
    return;
  }

  if (method === 'GET' && pathName === '/models/installed') {
    try {
      const models = await ollamaClient.listInstalledModels();
      sendJson(response, 200, { ok: true, models });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error, 503), toErrorPayload(error));
    }
    return;
  }

  if (method === 'GET' && pathName === '/config') {
    try {
      const config = await configStore.readConfig();
      sendJson(response, 200, { ok: true, config, path: configStore.path });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error), toErrorPayload(error));
    }
    return;
  }

  if (method === 'POST' && pathName === '/config') {
    const body = await readJsonBody(request);
    const defaultModel = isRecord(body) ? body.default_model : undefined;
    const errors = validateModelName(defaultModel, ['body', 'default_model']);
    if (errors.length > 0) {
      sendJson(response, 422, { detail: errors });
      return;
    }

    try {
      const config = await configStore.updateDefaultModel(String(defaultModel).trim());
      sendJson(response, 200, { ok: true, config, path: configStore.path });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error), toErrorPayload(error));
    }
    return;
  }

  if (method === 'POST' && pathName === '/model/load') {
    const body = await readJsonBody(request);
    const parsed = validateModelLoadRequest(body);
    if (!parsed.ok) {
      sendJson(response, 422, parsed.response);
      return;
    }

    const { model, make_default: makeDefault } = parsed.value;

    try {
      const prewarm = await ollamaClient.prewarmModel(model, runtimeConfig.prewarmKeepAlive, runtimeConfig.prewarmTimeoutMs);
      const config = makeDefault
        ? await configStore.updateDefaultModel(model)
        : await configStore.readConfig();
      const runningModels = await safeListRunningModels(ollamaClient, logger);
      const loaded = isDefaultModelLoaded(model, runningModels);

      sendJson(response, 200, {
        ok: true,
        model,
        made_default: makeDefault,
        loaded,
        default_model: config.default_model,
        prewarm: prewarm.response,
        running_models: runningModels
      });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error, 502), toErrorPayload(error, 'MODEL_LOAD_FAILED'));
    }
    return;
  }

  if (method === 'POST' && pathName === '/model/prewarm') {
    const body = await readJsonBody(request);
    let config: AppConfig;

    try {
      config = await configStore.readConfig();
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error), toErrorPayload(error));
      return;
    }

    const requestedModel = isRecord(body) && body.model !== undefined ? body.model : config.default_model;
    const errors = validateModelName(requestedModel, ['body', 'model']);
    if (errors.length > 0) {
      sendJson(response, 422, { detail: errors });
      return;
    }

    const model = String(requestedModel).trim();

    try {
      const prewarm = await ollamaClient.prewarmModel(model, runtimeConfig.prewarmKeepAlive, runtimeConfig.prewarmTimeoutMs);
      const runningModels = await safeListRunningModels(ollamaClient, logger);
      const loaded = isDefaultModelLoaded(model, runningModels);

      sendJson(response, 200, {
        ok: true,
        model,
        loaded,
        default_model: config.default_model,
        prewarm: prewarm.response,
        running_models: runningModels
      });
    } catch (error: unknown) {
      sendJson(response, statusCodeForError(error, 502), toErrorPayload(error, 'MODEL_PREWARM_FAILED'));
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: `No route for ${method} ${pathName}` } });
}


const OLLAMA_IMAGE_GENERATION_CAPABILITY = 'image';
const OLLAMA_IMAGE_INPUT_CAPABILITY = 'vision';

interface ImageGenerationCapability {
  enabled: boolean;
  provider: 'ollama';
  currentModel: string | null;
  installed: boolean | null;
  loaded: boolean | null;
  available: boolean;
  endpoint: '/api/images/generate';
  ollamaEndpoint: '/api/generate';
  requiredCapability: 'image';
  modelCapabilities: string[];
  supportsImageGeneration: boolean | null;
  supportsImageInput: boolean | null;
  maxPromptChars: number;
  reason?: string;
}

async function handleCapabilities(
  response: ServerResponse,
  configStore: ConfigStore,
  ollamaClient: OllamaClientLike,
  runtimeConfig: RuntimeConfig,
  logger: Logger
): Promise<void> {
  const imageGeneration = await resolveImageGenerationCapability(configStore, ollamaClient, runtimeConfig, logger);

  sendJson(response, 200, {
    ok: true,
    textGeneration: true,
    textStreaming: false,
    imageInput: imageGeneration.supportsImageInput === true,
    imageGeneration,
    modelCapabilities: buildModelCapabilityReport(imageGeneration)
  });
}

async function resolveImageGenerationCapability(
  configStore: ConfigStore,
  ollamaClient: OllamaClientLike,
  runtimeConfig: RuntimeConfig,
  logger: Logger
): Promise<ImageGenerationCapability> {
  const currentModel = await resolveCurrentModel(configStore);
  const baseCapability: Omit<ImageGenerationCapability, 'installed' | 'loaded' | 'available' | 'reason'> = {
    enabled: runtimeConfig.imageGenerationEnabled,
    provider: 'ollama',
    currentModel,
    endpoint: '/api/images/generate',
    ollamaEndpoint: '/api/generate',
    requiredCapability: OLLAMA_IMAGE_GENERATION_CAPABILITY,
    modelCapabilities: [],
    supportsImageGeneration: null,
    supportsImageInput: null,
    maxPromptChars: runtimeConfig.imageGenerationMaxPromptChars
  };

  if (!runtimeConfig.imageGenerationEnabled) {
    return {
      ...baseCapability,
      installed: null,
      loaded: null,
      available: false,
      reason: 'Image generation is disabled. Set IMAGE_GENERATION_ENABLED=true to enable it for an image-generation-capable provider/model.'
    };
  }

  if (!currentModel) {
    return {
      ...baseCapability,
      installed: null,
      loaded: null,
      available: false,
      reason: 'No current model is selected. Load or set a default model before generating images.'
    };
  }

  let installedModels;
  let runningModels;
  try {
    [installedModels, runningModels] = await Promise.all([
      ollamaClient.listInstalledModels(),
      safeListRunningModels(ollamaClient, logger)
    ]);
  } catch (error: unknown) {
    logger.warn({ err: error, model: currentModel }, 'Unable to verify current model for image generation');
    return {
      ...baseCapability,
      installed: null,
      loaded: null,
      available: false,
      reason: 'Unable to verify installed Ollama models for image generation.'
    };
  }

  const installed = modelListIncludes(installedModels, currentModel);
  const loaded = isDefaultModelLoaded(currentModel, runningModels);

  if (!installed) {
    return {
      ...baseCapability,
      installed,
      loaded,
      available: false,
      reason: `Current model ${currentModel} is not installed in Ollama.`
    };
  }

  try {
    const modelInfo = await ollamaClient.showModel(currentModel);
    const modelCapabilities = normalizeCapabilityList(modelInfo.capabilities);
    const supportsImageGeneration = capabilityListIncludes(modelCapabilities, OLLAMA_IMAGE_GENERATION_CAPABILITY);
    const supportsImageInput = capabilityListIncludes(modelCapabilities, OLLAMA_IMAGE_INPUT_CAPABILITY);

    return {
      ...baseCapability,
      installed,
      loaded,
      modelCapabilities,
      supportsImageGeneration,
      supportsImageInput,
      available: supportsImageGeneration,
      ...(supportsImageGeneration ? {} : { reason: unsupportedImageGenerationReason(currentModel, modelCapabilities, supportsImageInput) })
    };
  } catch (error: unknown) {
    logger.warn({ err: error, model: currentModel }, 'Unable to verify Ollama model capabilities for image generation');
    return {
      ...baseCapability,
      installed,
      loaded,
      available: false,
      reason: 'Unable to verify Ollama model capabilities. Image generation will not be routed to Ollama until the selected model reports capability "image".'
    };
  }
}

function buildModelCapabilityReport(imageGeneration: ImageGenerationCapability) {
  const supportsTextGeneration = capabilityListIncludes(imageGeneration.modelCapabilities, 'completion');
  const supportsImageInput = imageGeneration.supportsImageInput === true;

  return {
    provider: imageGeneration.provider,
    currentModel: imageGeneration.currentModel,
    installed: imageGeneration.installed,
    loaded: imageGeneration.loaded,
    ollamaCapabilities: imageGeneration.modelCapabilities,
    textGeneration: {
      available: supportsTextGeneration,
      exposedByService: true,
      serviceEndpoint: '/api/assistant/chat',
      providerEndpoint: '/api/chat',
      note: 'The service endpoint accepts prompt text only and selects the single currently loaded Ollama model server-side.'
    },
    chatCompletion: {
      available: supportsTextGeneration,
      exposedByService: true,
      serviceEndpoint: '/api/assistant/chat',
      providerEndpoint: '/api/chat',
      note: 'Client requests cannot select or load models.'
    },
    textStreaming: {
      available: supportsTextGeneration,
      exposedByService: false,
      providerEndpoint: '/api/generate'
    },
    imageInput: {
      available: supportsImageInput,
      exposedByService: false,
      providerEndpoint: '/api/chat',
      note: 'Vision/image input is a separate capability from image-generation output.'
    },
    imageGeneration: {
      available: imageGeneration.available,
      exposedByService: true,
      serviceEndpoint: imageGeneration.endpoint,
      providerEndpoint: imageGeneration.ollamaEndpoint,
      requiredCapability: imageGeneration.requiredCapability,
      reason: imageGeneration.reason
    }
  };
}

function normalizeCapabilityList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

function capabilityListIncludes(capabilities: string[], capability: string): boolean {
  const normalizedCapability = capability.toLowerCase();
  return capabilities.some((item) => item.toLowerCase() === normalizedCapability);
}

function unsupportedImageGenerationReason(model: string, capabilities: string[], supportsImageInput: boolean): string {
  const reported = capabilities.length > 0
    ? ` Reported Ollama capabilities: ${capabilities.join(', ')}.`
    : ' No Ollama capabilities were reported for the selected model.';
  const imageInputNote = supportsImageInput
    ? ' The model supports image input/vision, but vision is not image-generation output.'
    : '';

  return `Current model ${model} does not report Ollama image-generation capability "image".${reported}${imageInputNote} Select an Ollama image-generation model or configure a separate image-generation provider.`;
}


async function handleAssistantChat(
  request: IncomingMessage,
  response: ServerResponse,
  ollamaClient: OllamaClientLike,
  runtimeConfig: RuntimeConfig
): Promise<void> {
  const body = await readJsonBody(request);
  const parsed = validateAssistantChatRequest(body);

  if (!parsed.ok) {
    sendJson(response, 422, parsed.response);
    return;
  }

  let runningModels: OllamaRunningModel[];
  try {
    runningModels = await ollamaClient.listRunningModels();
  } catch (error: unknown) {
    sendJson(response, statusCodeForError(error, 503), toErrorPayload(error, 'ASSISTANT_RUNNING_MODEL_CHECK_FAILED'));
    return;
  }

  const selectedModel = resolveExactlyOneLoadedModel(runningModels);
  if (!selectedModel.ok) {
    sendJson(response, selectedModel.statusCode, selectedModel.payload);
    return;
  }

  const abortController = new AbortController();
  const abortAssistantChat = () => {
    if (!response.writableEnded) abortController.abort();
  };
  request.on('aborted', abortAssistantChat);
  response.on('close', abortAssistantChat);

  try {
    const messages = buildAssistantMessages(parsed.value.prompt, parsed.value.system_prompt);
    const result = await ollamaClient.chat({
      model: selectedModel.model,
      messages,
      timeoutMs: runtimeConfig.ollamaRequestTimeoutMs,
      signal: abortController.signal
    });

    sendJson(response, 200, {
      ok: true,
      text: result.text,
      model: result.model,
      metadata: {
        provider: 'ollama',
        endpoint: '/api/chat',
        loadedModelCount: runningModels.length,
        ...result.metadata
      }
    });
  } catch (error: unknown) {
    sendJson(response, statusCodeForError(error, 502), toErrorPayload(error, 'ASSISTANT_CHAT_FAILED'));
  } finally {
    request.off('aborted', abortAssistantChat);
    response.off('close', abortAssistantChat);
  }
}

function buildAssistantMessages(prompt: string, systemPrompt?: string): OllamaChatMessage[] {
  return [
    ...(systemPrompt === undefined ? [] : [{ role: 'system' as const, content: systemPrompt }]),
    { role: 'user' as const, content: prompt }
  ];
}

function resolveExactlyOneLoadedModel(runningModels: OllamaRunningModel[]):
  | { ok: true; model: string }
  | { ok: false; statusCode: number; payload: { ok: false; error: { code: string; message: string; details?: unknown } } } {
  if (runningModels.length === 0) {
    return {
      ok: false,
      statusCode: 503,
      payload: {
        ok: false,
        error: {
          code: 'ASSISTANT_MODEL_NOT_LOADED',
          message: 'No Ollama model is currently loaded. The assistant chat endpoint fails closed rather than selecting or loading a model.'
        }
      }
    };
  }

  if (runningModels.length > 1) {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        ok: false,
        error: {
          code: 'ASSISTANT_MODEL_AMBIGUOUS',
          message: 'More than one Ollama model is currently loaded. The assistant chat endpoint fails closed because it cannot safely infer which model to use.',
          details: {
            loadedModels: runningModels.map((model) => ({ name: model.name ?? null, model: model.model ?? null }))
          }
        }
      }
    };
  }

  const onlyModel = runningModels[0];
  const modelName = readRunningModelIdentifier(onlyModel);
  if (!modelName) {
    return {
      ok: false,
      statusCode: 503,
      payload: {
        ok: false,
        error: {
          code: 'ASSISTANT_MODEL_IDENTIFIER_MISSING',
          message: 'Exactly one Ollama model is loaded, but its running-model record does not contain a usable model identifier.',
          details: { loadedModel: onlyModel }
        }
      }
    };
  }

  return { ok: true, model: modelName };
}

function readRunningModelIdentifier(model: OllamaRunningModel | undefined): string | null {
  if (!model) return null;
  if (typeof model.model === 'string' && model.model.trim()) return model.model.trim();
  if (typeof model.name === 'string' && model.name.trim()) return model.name.trim();
  return null;
}

async function handleImageGeneration(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
  ollamaClient: OllamaClientLike,
  runtimeConfig: RuntimeConfig,
  logger: Logger
): Promise<void> {
  const body = await readJsonBody(request);
  const prompt = readBodyString(body, 'prompt');

  if (!runtimeConfig.imageGenerationEnabled) {
    sendJson(response, 503, {
      ok: false,
      error: {
        code: 'IMAGE_GENERATION_DISABLED',
        message: 'Image generation is disabled on local-ai-llm. Set IMAGE_GENERATION_ENABLED=true to enable image generation with the current model.'
      }
    });
    return;
  }

  const currentModel = await resolveCurrentModel(configStore);
  if (!currentModel) {
    sendJson(response, 503, {
      ok: false,
      error: {
        code: 'IMAGE_MODEL_NOT_SELECTED',
        message: 'Image generation requires a current model. Load or set a default model before generating images.'
      }
    });
    return;
  }

  if (!prompt) {
    sendJson(response, 422, validationDetail(['body', 'prompt'], 'Prompt must be a non-empty string.', 'string_too_short'));
    return;
  }

  if (prompt.length > runtimeConfig.imageGenerationMaxPromptChars) {
    sendJson(response, 422, validationDetail(['body', 'prompt'], `Prompt must be ${runtimeConfig.imageGenerationMaxPromptChars} characters or fewer.`, 'string_too_long'));
    return;
  }

  const requestedModel = readBodyString(body, 'model');
  if (requestedModel && requestedModel !== currentModel) {
    sendJson(response, 400, {
      ok: false,
      error: {
        code: 'IMAGE_MODEL_OVERRIDE_NOT_ALLOWED',
        message: 'Image generation model overrides are not allowed. The current loaded/default model is used for image generation.'
      }
    });
    return;
  }

  const imageGenerationCapability = await resolveImageGenerationCapability(configStore, ollamaClient, runtimeConfig, logger);

  if (imageGenerationCapability.installed === false) {
    sendJson(response, 404, {
      ok: false,
      error: {
        code: 'IMAGE_MODEL_NOT_INSTALLED',
        message: imageGenerationCapability.reason ?? `Current model ${currentModel} is not installed in Ollama.`,
        details: {
          provider: 'ollama',
          model: currentModel,
          requiredCapability: imageGenerationCapability.requiredCapability,
          reportedCapabilities: imageGenerationCapability.modelCapabilities
        }
      }
    });
    return;
  }

  if (imageGenerationCapability.supportsImageGeneration === false) {
    sendJson(response, 422, {
      ok: false,
      error: {
        code: 'IMAGE_GENERATION_UNSUPPORTED_MODEL',
        message: imageGenerationCapability.reason ?? `Current model ${currentModel} does not support image generation through Ollama.`,
        details: {
          provider: 'ollama',
          model: currentModel,
          requiredCapability: imageGenerationCapability.requiredCapability,
          reportedCapabilities: imageGenerationCapability.modelCapabilities,
          supportsImageInput: imageGenerationCapability.supportsImageInput,
          supportsImageGeneration: imageGenerationCapability.supportsImageGeneration,
          endpoint: imageGenerationCapability.endpoint,
          ollamaEndpoint: imageGenerationCapability.ollamaEndpoint
        }
      }
    });
    return;
  }

  if (!imageGenerationCapability.available) {
    sendJson(response, 503, {
      ok: false,
      error: {
        code: 'IMAGE_MODEL_CAPABILITY_UNVERIFIED',
        message: imageGenerationCapability.reason ?? 'Unable to verify that the selected model supports image generation through Ollama.',
        details: {
          provider: 'ollama',
          model: currentModel,
          requiredCapability: imageGenerationCapability.requiredCapability,
          reportedCapabilities: imageGenerationCapability.modelCapabilities
        }
      }
    });
    return;
  }

  const options = readImageOptions(body);
  const abortController = new AbortController();
  const abortImageGeneration = () => {
    if (!response.writableEnded) abortController.abort();
  };
  request.on('aborted', abortImageGeneration);
  response.on('close', abortImageGeneration);

  try {
    const result = await ollamaClient.generateImage({
      model: currentModel,
      prompt,
      timeoutMs: runtimeConfig.imageGenerationTimeoutMs,
      signal: abortController.signal,
      ...options
    });

    sendJson(response, 200, {
      ok: true,
      model: result.model,
      images: result.images,
      metadata: {
        provider: 'ollama',
        endpoint: '/api/generate',
        experimental: true,
        ...result.metadata
      }
    });
  } catch (error: unknown) {
    sendJson(response, statusCodeForError(error, 502), toErrorPayload(error, 'IMAGE_GENERATION_FAILED'));
  } finally {
    request.off('aborted', abortImageGeneration);
    response.off('close', abortImageGeneration);
  }
}

async function resolveCurrentModel(configStore: ConfigStore): Promise<string | null> {
  const config = await configStore.readConfig();
  const currentModel = config.default_model.trim();
  return currentModel === '' ? null : currentModel;
}

function readImageOptions(body: unknown): OllamaImageGenerateOptions {
  const record = isRecord(body) ? body : {};
  const optionsRecord = isRecord(record.options) ? record.options : {};
  const width = readPositiveInteger(record.width ?? optionsRecord.width, 4096);
  const height = readPositiveInteger(record.height ?? optionsRecord.height, 4096);
  const steps = readPositiveInteger(record.steps ?? optionsRecord.steps, 250);

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(steps !== undefined ? { steps } : {})
  };
}

function readPositiveInteger(value: unknown, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new AppError('IMAGE_OPTION_INVALID', `Image generation option must be a positive integer no larger than ${max}.`, 422);
  }
  return parsed;
}

function readBodyString(body: unknown, key: string): string | null {
  if (!isRecord(body)) return null;
  const value = body[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function modelListIncludes(models: Array<{ name?: string; model?: string }>, model: string): boolean {
  const normalizedModel = model.toLowerCase();
  return models.some((item) => item.name?.toLowerCase() === normalizedModel || item.model?.toLowerCase() === normalizedModel);
}

function validationDetail(loc: Array<string | number>, msg: string, type: string) {
  return {
    detail: [
      {
        loc,
        msg,
        type,
        ctx: {}
      }
    ]
  };
}

async function handleHealth(response: ServerResponse, configStore: ConfigStore, ollamaClient: OllamaClientLike, runtimeConfig: RuntimeConfig): Promise<void> {
  let config: AppConfig;
  try {
    config = await configStore.readConfig();
  } catch (error: unknown) {
    sendJson(response, statusCodeForError(error), toErrorPayload(error));
    return;
  }

  try {
    const [runningModels, ollamaVersion] = await Promise.all([
      ollamaClient.listRunningModels(),
      ollamaClient.getVersion().catch(() => null)
    ]);
    const defaultModelLoaded = isDefaultModelLoaded(config.default_model, runningModels);

    sendJson(response, 200, {
      ok: true,
      service: SERVICE_NAME,
      version: APPLICATION_VERSION,
      runtime: RUNTIME_NAME,
      default_model: config.default_model,
      default_model_loaded: defaultModelLoaded,
      running_models: runningModels,
      ollama: {
        ok: true,
        base_url: runtimeConfig.ollamaBaseUrl,
        version: ollamaVersion
      }
    });
  } catch (error: unknown) {
    const payload = toErrorPayload(error);
    sendJson(response, statusCodeForError(error, 503), {
      ok: false,
      service: SERVICE_NAME,
      version: APPLICATION_VERSION,
      runtime: RUNTIME_NAME,
      default_model: config.default_model,
      default_model_loaded: false,
      running_models: [],
      ollama: {
        ok: false,
        base_url: runtimeConfig.ollamaBaseUrl
      },
      error: payload.error
    });
  }
}

async function safeListRunningModels(ollamaClient: OllamaClientLike, logger: Logger) {
  try {
    return await ollamaClient.listRunningModels();
  } catch (error: unknown) {
    logger.warn({ err: error }, 'Model was pre-warmed but running model verification failed');
    return [];
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 1024 * 1024) {
      throw new Error('Request body is too large');
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, body: string, contentType: string): void {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function readPublicAsset(fileName: string, logger: Logger): Promise<string> {
  const assetPath = path.resolve(process.cwd(), 'public', fileName);
  try {
    return await fs.readFile(assetPath, 'utf8');
  } catch (error: unknown) {
    logger.error({ err: error, assetPath }, 'Unable to read public asset');
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function renderPortalHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${SERVICE_NAME}</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <header class="site-header">
    <div>
      <p class="eyebrow">Bare-metal local AI appliance</p>
      <h1>${SERVICE_NAME}</h1>
      <p class="muted">Node compatibility API, Ollama model controls, and NVIDIA multi-GPU telemetry.</p>
    </div>
    <button id="refresh-button" type="button">Refresh</button>
  </header>

  <main>
    <section class="grid two">
      <article class="card" id="health-card">
        <h2>Service health</h2>
        <div id="health-content" class="placeholder">Loading health...</div>
      </article>

      <article class="card" id="config-card">
        <h2>Default model</h2>
        <form id="config-form" class="stack">
          <label>
            Default model
            <input id="default-model-input" name="default_model" type="text" maxlength="128" placeholder="qwen3:14b">
          </label>
          <div class="button-row">
            <button type="submit">Save default</button>
            <button id="prewarm-default-button" type="button">Pre-warm default</button>
          </div>
        </form>
        <p class="hint">Startup pre-warm is controlled by <code>PREWARM_DEFAULT_MODEL_ON_START</code>.</p>
      </article>
    </section>

    <section class="card">
      <h2>Load or pre-warm a model</h2>
      <form id="load-form" class="inline-form">
        <label>
          Model name
          <input id="load-model-input" name="model" type="text" maxlength="128" required placeholder="llama3.2:latest">
        </label>
        <label class="checkbox-label">
          <input id="make-default-input" name="make_default" type="checkbox">
          Make default
        </label>
        <button type="submit">Load model</button>
      </form>
      <div id="operation-feedback" class="feedback" aria-live="polite"></div>
    </section>

    <section class="grid two">
      <article class="card">
        <h2>Running models</h2>
        <div id="running-models" class="placeholder">Loading running models...</div>
      </article>
      <article class="card">
        <h2>Installed models</h2>
        <div id="installed-models" class="placeholder">Loading installed models...</div>
      </article>
    </section>

    <section class="card">
      <div class="section-heading">
        <h2>GPU telemetry</h2>
        <p class="hint"><code>/gpu</code> is legacy single-GPU compatibility. New integrations should use <code>/gpus</code>.</p>
      </div>
      <div id="gpu-list" class="gpu-grid placeholder">Loading GPU telemetry...</div>
    </section>
  </main>

  <footer>
    <span>${SERVICE_NAME} ${APPLICATION_VERSION}</span>
    <a href="/openapi.json">OpenAPI</a>
  </footer>
  <script src="/assets/app.js" type="module"></script>
</body>
</html>`;
}
