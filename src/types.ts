export interface RuntimeConfig {
  host: string;
  port: number;
  ollamaBaseUrl: string;
  ollamaRequestTimeoutMs: number;
  configPath: string;
  defaultModel: string;
  prewarmDefaultModelOnStart: boolean;
  prewarmTimeoutMs: number;
  prewarmKeepAlive: string | number;
  imageGenerationEnabled: boolean;
  imageGenerationTimeoutMs: number;
  imageGenerationMaxPromptChars: number;
  gpuQueryTimeoutMs: number;
  logLevel: string;
}

export interface AppConfig {
  default_model: string;
}

export interface OllamaModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
  [key: string]: unknown;
}

export interface OllamaRunningModel {
  name?: string;
  model?: string;
  size?: number;
  digest?: string;
  details?: OllamaModelDetails;
  expires_at?: string;
  size_vram?: number;
  context_length?: number;
  [key: string]: unknown;
}

export interface OllamaInstalledModel {
  name?: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: OllamaModelDetails;
  capabilities?: string[];
  [key: string]: unknown;
}

export interface OllamaModelInformation {
  details?: OllamaModelDetails;
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  modelInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GeneratedImageData {
  mimeType: string;
  base64: string;
  width?: number;
  height?: number;
}

export interface OllamaImageGenerateOptions {
  width?: number;
  height?: number;
  steps?: number;
}

export interface OllamaImageGenerateRequest extends OllamaImageGenerateOptions {
  model: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OllamaImageGenerateResult {
  model: string;
  images: GeneratedImageData[];
  metadata: Record<string, unknown>;
}

export interface GpuTelemetry {
  index: number;
  uuid: string | null;
  name: string;
  driver_version: string | null;
  memory_total_mib: number | null;
  memory_used_mib: number | null;
  memory_free_mib: number | null;
  utilization_gpu_percent: number | null;
  temperature_c: number | null;
  power_draw_w: number | null;
  power_limit_w: number | null;
  warnings?: string[];
}

export interface LegacyGpuTelemetry {
  name: string;
  driver_version: string | null;
  memory_total_mib: number | null;
  memory_used_mib: number | null;
  memory_free_mib: number | null;
  utilization_gpu_percent: number | null;
  temperature_c: number | null;
  power_draw_w: number | null;
  power_limit_w: number | null;
}

export interface PrewarmResult {
  model: string;
  response?: unknown;
}

export interface OllamaClientLike {
  getVersion(): Promise<string | null>;
  listRunningModels(): Promise<OllamaRunningModel[]>;
  listInstalledModels(): Promise<OllamaInstalledModel[]>;
  showModel(model: string): Promise<OllamaModelInformation>;
  prewarmModel(model: string, keepAlive: string | number, timeoutMs?: number): Promise<PrewarmResult>;
  generateImage(request: OllamaImageGenerateRequest): Promise<OllamaImageGenerateResult>;
}

export interface GpuServiceLike {
  queryGpus(): Promise<GpuTelemetry[]>;
}
