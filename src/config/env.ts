import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeConfig } from '../types.ts';

loadDotEnvFile(path.resolve(process.cwd(), '.env'));

function loadDotEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readKeepAlive(name: string, fallback: string | number): string | number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const trimmed = raw.trim();
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && trimmed !== '' ? numeric : trimmed;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const configPath = readString('CONFIG_PATH', './config/local-ai-llm.json');

  return {
    host: readString('HOST', '0.0.0.0'),
    port: readNumber('PORT', 8000),
    ollamaBaseUrl: readString('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    ollamaRequestTimeoutMs: readNumber('OLLAMA_REQUEST_TIMEOUT_MS', 30000),
    configPath: path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath),
    defaultModel: readString('DEFAULT_MODEL', 'llama3.2:latest'),
    prewarmDefaultModelOnStart: readBoolean('PREWARM_DEFAULT_MODEL_ON_START', true),
    prewarmTimeoutMs: readNumber('PREWARM_TIMEOUT_MS', 120000),
    prewarmKeepAlive: readKeepAlive('PREWARM_KEEP_ALIVE', -1),
    imageGenerationEnabled: readBoolean('IMAGE_GENERATION_ENABLED', false),
    imageGenerationTimeoutMs: readNumber('IMAGE_GENERATION_TIMEOUT_MS', 600000),
    imageGenerationMaxPromptChars: readNumber('IMAGE_GENERATION_MAX_PROMPT_CHARS', 4000),
    gpuQueryTimeoutMs: readNumber('GPU_QUERY_TIMEOUT_MS', 5000),
    logLevel: readString('LOG_LEVEL', 'info')
  };
}
