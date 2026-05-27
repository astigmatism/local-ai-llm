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
    details: modelDetailsSchema
  }
} as const;

const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] } as const;
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const;

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
        LegacyGpuTelemetry: legacyGpuSchema
      }
    }
  };
}
