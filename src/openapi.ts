import { APPLICATION_VERSION, OPENAPI_VERSION, RUNTIME_NAME, SERVICE_NAME } from './version.ts';

const errorSchema = {
  type: 'object',
  required: ['ok', 'error'],
  properties: {
    ok: { const: false },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {}
      }
    }
  }
} as const;

const validationErrorSchema = {
  type: 'object',
  required: ['detail'],
  properties: {
    detail: {
      type: 'array',
      items: {
        type: 'object',
        required: ['loc', 'msg', 'type', 'ctx'],
        properties: {
          loc: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
          msg: { type: 'string' },
          type: { type: 'string' },
          input: {},
          ctx: { type: 'object', additionalProperties: true }
        }
      }
    }
  }
} as const;

const modelDetailsSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    parent_model: { type: 'string' },
    format: { type: 'string' },
    family: { type: 'string' },
    families: { type: 'array', items: { type: 'string' } },
    parameter_size: { type: 'string' },
    quantization_level: { type: 'string' }
  }
} as const;

const runningModelSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name: { type: 'string' },
    model: { type: 'string' },
    size: { type: 'number' },
    digest: { type: 'string' },
    details: modelDetailsSchema,
    expires_at: { type: 'string' },
    size_vram: { type: 'number' },
    context_length: { type: 'number' }
  }
} as const;

const installedModelSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name: { type: 'string' },
    model: { type: 'string' },
    modified_at: { type: 'string' },
    size: { type: 'number' },
    digest: { type: 'string' },
    details: modelDetailsSchema,
    capabilities: { type: 'array', items: { type: 'string' } }
  }
} as const;

const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] } as const;
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const;
const nullableBoolean = { oneOf: [{ type: 'boolean' }, { type: 'null' }] } as const;

const gpuSchema = {
  type: 'object',
  required: [
    'index',
    'uuid',
    'name',
    'driver_version',
    'memory_total_mib',
    'memory_used_mib',
    'memory_free_mib',
    'utilization_gpu_percent',
    'temperature_c',
    'power_draw_w',
    'power_limit_w'
  ],
  properties: {
    index: { type: 'number' },
    uuid: nullableString,
    name: { type: 'string' },
    driver_version: nullableString,
    memory_total_mib: nullableNumber,
    memory_used_mib: nullableNumber,
    memory_free_mib: nullableNumber,
    utilization_gpu_percent: nullableNumber,
    temperature_c: nullableNumber,
    power_draw_w: nullableNumber,
    power_limit_w: nullableNumber,
    warnings: { type: 'array', items: { type: 'string' } }
  }
} as const;

const assistantChatResponseSchema = {
  type: 'object',
  required: ['ok', 'text', 'model', 'metadata'],
  properties: {
    ok: { const: true },
    text: { type: 'string' },
    model: { type: 'string', description: 'The currently loaded Ollama model selected server-side. Clients do not submit this value.' },
    metadata: { type: 'object', additionalProperties: true }
  }
} as const;

const generatedImageSchema = {
  type: 'object',
  required: ['mimeType', 'base64'],
  properties: {
    mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
    base64: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' }
  }
} as const;

const imageGenerationCapabilitySchema = {
  type: 'object',
  required: [
    'enabled',
    'provider',
    'currentModel',
    'installed',
    'loaded',
    'available',
    'endpoint',
    'ollamaEndpoint',
    'requiredCapability',
    'modelCapabilities',
    'supportsImageGeneration',
    'supportsImageInput',
    'maxPromptChars'
  ],
  properties: {
    enabled: { type: 'boolean' },
    provider: { const: 'ollama' },
    currentModel: { ...nullableString, description: 'Model currently selected by local-ai-llm for generation.' },
    installed: { ...nullableBoolean, description: 'Whether the current model is installed, or null when disabled/unverified.' },
    loaded: { ...nullableBoolean, description: 'Whether the current model appears in Ollama running-model state, or null when disabled/unverified.' },
    available: { type: 'boolean', description: 'True only when image generation is enabled, the model is installed, and Ollama reports the image-generation capability.' },
    endpoint: { const: '/api/images/generate' },
    ollamaEndpoint: { const: '/api/generate' },
    requiredCapability: { const: 'image' },
    modelCapabilities: { type: 'array', items: { type: 'string' }, description: 'Raw capability names reported by Ollama POST /api/show.' },
    supportsImageGeneration: { ...nullableBoolean, description: 'True when Ollama reports capability "image" for the selected model.' },
    supportsImageInput: { ...nullableBoolean, description: 'True when Ollama reports capability "vision". This is input understanding, not image output.' },
    maxPromptChars: { type: 'number' },
    reason: { type: 'string' }
  }
} as const;

const capabilityAvailabilitySchema = {
  type: 'object',
  required: ['available', 'exposedByService'],
  additionalProperties: true,
  properties: {
    available: { type: 'boolean' },
    exposedByService: { type: 'boolean' },
    providerEndpoint: { type: 'string' },
    serviceEndpoint: { type: 'string' },
    requiredCapability: { type: 'string' },
    reason: { type: 'string' },
    note: { type: 'string' }
  }
} as const;

const modelCapabilityReportSchema = {
  type: 'object',
  required: [
    'provider',
    'currentModel',
    'installed',
    'loaded',
    'ollamaCapabilities',
    'textGeneration',
    'chatCompletion',
    'textStreaming',
    'imageInput',
    'imageGeneration'
  ],
  properties: {
    provider: { const: 'ollama' },
    currentModel: nullableString,
    installed: nullableBoolean,
    loaded: nullableBoolean,
    ollamaCapabilities: { type: 'array', items: { type: 'string' } },
    textGeneration: capabilityAvailabilitySchema,
    chatCompletion: capabilityAvailabilitySchema,
    textStreaming: capabilityAvailabilitySchema,
    imageInput: capabilityAvailabilitySchema,
    imageGeneration: capabilityAvailabilitySchema
  }
} as const;


const legacyGpuSchema = {
  type: 'object',
  required: [
    'name',
    'driver_version',
    'memory_total_mib',
    'memory_used_mib',
    'memory_free_mib',
    'utilization_gpu_percent',
    'temperature_c',
    'power_draw_w',
    'power_limit_w'
  ],
  properties: {
    name: { type: 'string' },
    driver_version: nullableString,
    memory_total_mib: nullableNumber,
    memory_used_mib: nullableNumber,
    memory_free_mib: nullableNumber,
    utilization_gpu_percent: nullableNumber,
    temperature_c: nullableNumber,
    power_draw_w: nullableNumber,
    power_limit_w: nullableNumber
  }
} as const;

export function buildOpenApiDocument() {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: SERVICE_NAME,
      version: APPLICATION_VERSION,
      description: `Node-based ${SERVICE_NAME} compatibility API and portal runtime (${RUNTIME_NAME}).`
    },
    servers: [
      { url: 'http://127.0.0.1:8000', description: 'Local monitor URL' }
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Monitor and Ollama health',
          responses: {
            '200': {
              description: 'Monitor can contact Ollama and report running/default model state',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'default_model', 'default_model_loaded', 'running_models'],
                    properties: {
                      ok: { const: true },
                      service: { type: 'string' },
                      version: { type: 'string' },
                      runtime: { type: 'string' },
                      default_model: { type: 'string' },
                      default_model_loaded: { type: 'boolean' },
                      running_models: { type: 'array', items: runningModelSchema },
                      ollama: { type: 'object', additionalProperties: true }
                    }
                  }
                }
              }
            },
            '503': { description: 'Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/api/capabilities': {
        get: {
          summary: 'Service capability report',
          description: 'Reports provider/model capabilities separately from service-exposed endpoints. Vision/image input and image-generation output are separate capabilities.',
          responses: {
            '200': {
              description: 'Capability report',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'textGeneration', 'textStreaming', 'imageInput', 'imageGeneration', 'modelCapabilities'],
                    properties: {
                      ok: { const: true },
                      textGeneration: { type: 'boolean', description: 'Compatibility field for this service API. Detailed provider capability is in modelCapabilities.textGeneration.' },
                      textStreaming: { type: 'boolean', description: 'Compatibility field for this service API. Detailed provider capability is in modelCapabilities.textStreaming.' },
                      imageInput: { type: 'boolean', description: 'Whether the selected Ollama model reports vision/image-input support.' },
                      imageGeneration: imageGenerationCapabilitySchema,
                      modelCapabilities: modelCapabilityReportSchema
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/assistant/chat': {
        post: {
          summary: 'Generate assistant text with the single currently loaded Ollama model',
          description: 'Private orchestrator-facing endpoint for voice assistants. The request intentionally does not accept a model field. The service checks Ollama running-model state, requires exactly one loaded model, and fails closed instead of selecting or loading models.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  additionalProperties: true,
                  properties: {
                    prompt: { type: 'string', minLength: 1, maxLength: 16000 },
                    system_prompt: { type: 'string', maxLength: 4000 }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Assistant response text', content: { 'application/json': { schema: assistantChatResponseSchema } } },
            '409': { description: 'Multiple loaded models make model selection ambiguous', content: { 'application/json': { schema: errorSchema } } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: validationErrorSchema } } },
            '502': { description: 'Ollama chat request failed', content: { 'application/json': { schema: errorSchema } } },
            '503': { description: 'No usable loaded model or Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/api/images/generate': {
        post: {
          summary: 'Generate an image with the current Ollama model',
          description: 'Private orchestrator-facing endpoint. It calls Ollama POST /api/generate with stream=false only when the current model reports Ollama image-generation capability "image".',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    prompt: { type: 'string', minLength: 1 },
                    model: { type: 'string', description: 'Optional compatibility field. When supplied, it must match the current model.' },
                    options: {
                      type: 'object',
                      properties: {
                        width: { type: 'number' },
                        height: { type: 'number' },
                        steps: { type: 'number' }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Generated image data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'model', 'images', 'metadata'],
                    properties: {
                      ok: { const: true },
                      model: { type: 'string' },
                      images: { type: 'array', items: generatedImageSchema },
                      metadata: { type: 'object', additionalProperties: true }
                    }
                  }
                }
              }
            },
            '400': { description: 'Unsupported model override', content: { 'application/json': { schema: errorSchema } } },
            '404': { description: 'Current/default model is not installed', content: { 'application/json': { schema: errorSchema } } },
            '422': { description: 'Validation error or unsupported image-generation capability', content: { 'application/json': { schema: { oneOf: [validationErrorSchema, errorSchema] } } } },
            '502': { description: 'Ollama returned no valid image data after capability gating', content: { 'application/json': { schema: errorSchema } } },
            '503': { description: 'Image generation disabled, no current model, or Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/gpu': {
        get: {
          summary: 'Legacy primary GPU telemetry',
          description: 'Compatibility endpoint that returns only one deterministic primary GPU. New consumers should use /gpus.',
          responses: {
            '200': {
              description: 'Primary GPU telemetry',
              content: { 'application/json': { schema: { type: 'object', required: ['ok', 'gpu'], properties: { ok: { const: true }, gpu: legacyGpuSchema } } } }
            },
            '503': { description: 'GPU telemetry unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/gpus': {
        get: {
          summary: 'All detected NVIDIA GPUs',
          responses: {
            '200': {
              description: 'All GPU telemetry rows',
              content: { 'application/json': { schema: { type: 'object', required: ['ok', 'gpus'], properties: { ok: { const: true }, gpus: { type: 'array', items: gpuSchema } } } } }
            },
            '503': { description: 'GPU telemetry unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/models/running': {
        get: {
          summary: 'Running Ollama models',
          responses: {
            '200': { description: 'Models currently loaded into memory', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'models'], properties: { ok: { const: true }, models: { type: 'array', items: runningModelSchema } } } } } },
            '503': { description: 'Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/models/installed': {
        get: {
          summary: 'Installed/pulled Ollama models',
          responses: {
            '200': { description: 'Models available locally to Ollama', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'models'], properties: { ok: { const: true }, models: { type: 'array', items: installedModelSchema } } } } } },
            '503': { description: 'Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/config': {
        get: {
          summary: 'Read local monitor configuration',
          responses: {
            '200': { description: 'Configuration', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'config'], properties: { ok: { const: true }, config: { type: 'object', required: ['default_model'], properties: { default_model: { type: 'string' } } } } } } } },
            '500': { description: 'Config read failed', content: { 'application/json': { schema: errorSchema } } }
          }
        },
        post: {
          summary: 'Update default model configuration',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['default_model'], properties: { default_model: { type: 'string', minLength: 1, maxLength: 128 } } } } }
          },
          responses: {
            '200': { description: 'Updated configuration', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'config'], properties: { ok: { const: true }, config: { type: 'object', required: ['default_model'], properties: { default_model: { type: 'string' } } } } } } } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: validationErrorSchema } } },
            '500': { description: 'Config write failed', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/model/load': {
        post: {
          summary: 'Load/pre-warm an Ollama model',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['model'],
                  properties: {
                    model: { type: 'string', minLength: 1, maxLength: 128 },
                    make_default: { type: 'boolean', default: false }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Model pre-warmed',
              content: { 'application/json': { schema: { type: 'object', required: ['ok', 'model', 'made_default', 'loaded', 'default_model'], properties: { ok: { const: true }, model: { type: 'string' }, made_default: { type: 'boolean' }, loaded: { type: 'boolean' }, default_model: { type: 'string' }, prewarm: { type: 'object', additionalProperties: true } } } } }
            },
            '404': { description: 'Model not found by Ollama', content: { 'application/json': { schema: errorSchema } } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: validationErrorSchema } } },
            '503': { description: 'Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/model/prewarm': {
        post: {
          summary: 'Pre-warm a model or the configured default model',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    model: { type: 'string', minLength: 1, maxLength: 128 }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Model pre-warmed',
              content: { 'application/json': { schema: { type: 'object', required: ['ok', 'model', 'loaded', 'default_model'], properties: { ok: { const: true }, model: { type: 'string' }, loaded: { type: 'boolean' }, default_model: { type: 'string' }, prewarm: { type: 'object', additionalProperties: true } } } } }
            },
            '404': { description: 'Model not found by Ollama', content: { 'application/json': { schema: errorSchema } } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: validationErrorSchema } } },
            '503': { description: 'Ollama unavailable', content: { 'application/json': { schema: errorSchema } } }
          }
        }
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI document',
          responses: {
            '200': { description: 'OpenAPI 3.1 document' }
          }
        }
      }
    },
    components: {
      schemas: {
        ErrorResponse: errorSchema,
        ValidationError: validationErrorSchema,
        RunningModel: runningModelSchema,
        InstalledModel: installedModelSchema,
        GpuTelemetry: gpuSchema,
        LegacyGpuTelemetry: legacyGpuSchema,
        AssistantChatResponse: assistantChatResponseSchema,
        GeneratedImage: generatedImageSchema,
        ImageGenerationCapability: imageGenerationCapabilitySchema,
        ModelCapabilityReport: modelCapabilityReportSchema
      }
    }
  };
}
