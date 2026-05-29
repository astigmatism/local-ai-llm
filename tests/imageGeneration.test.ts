import assert from 'node:assert/strict';
import test from 'node:test';
import { mockGpuService, mockOllama, tempConfigStore, testRuntimeConfig, withTestServer } from './helpers.ts';
import type { OllamaImageGenerateRequest } from '../src/types.ts';

const imageModel = 'sdxl:latest';
const installedImageModel = { name: imageModel, model: imageModel };

test('GET /api/capabilities reports image generation disabled by default', async () => {
  await withTestServer({
    runtimeConfig: testRuntimeConfig(),
    configStore: await tempConfigStore(),
    ollamaClient: mockOllama([], [installedImageModel]),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.imageGeneration.available, false);
    assert.equal(body.imageGeneration.enabled, false);
    assert.equal(body.imageGeneration.currentModel, 'qwen3:14b');
    assert.equal(body.imageGeneration.loaded, null);
    assert.match(body.imageGeneration.reason, /disabled/i);
  });
});

test('POST /api/images/generate returns a disabled error when disabled', async () => {
  await withTestServer({
    runtimeConfig: testRuntimeConfig(),
    configStore: await tempConfigStore(imageModel),
    ollamaClient: mockOllama([], [installedImageModel]),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a bear castle at sunset' })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'IMAGE_GENERATION_DISABLED');
  });
});

test('POST /api/images/generate requires the current model to be installed', async () => {
  await withTestServer({
    runtimeConfig: testRuntimeConfig({ imageGenerationEnabled: true }),
    configStore: await tempConfigStore(imageModel),
    ollamaClient: mockOllama([], [{ name: 'qwen3:14b', model: 'qwen3:14b' }]),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a bear castle at sunset' })
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, 'IMAGE_MODEL_NOT_INSTALLED');
  });
});

test('POST /api/images/generate uses the current Ollama model and returns base64 image data', async () => {
  let observedRequest: OllamaImageGenerateRequest | null = null;

  await withTestServer({
    runtimeConfig: testRuntimeConfig({ imageGenerationEnabled: true, imageGenerationTimeoutMs: 12345 }),
    configStore: await tempConfigStore(imageModel),
    ollamaClient: mockOllama([], [installedImageModel], undefined, (request) => {
      observedRequest = request;
    }),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a bear castle at sunset', options: { width: 1024, height: 768, steps: 30 } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.model, imageModel);
    assert.equal(body.images[0].mimeType, 'image/png');
    assert.equal(typeof body.images[0].base64, 'string');
    assert.equal(body.metadata.endpoint, '/api/generate');
    assert.equal(observedRequest?.model, imageModel);
    assert.equal(observedRequest?.prompt, 'a bear castle at sunset');
    assert.equal(observedRequest?.timeoutMs, 12345);
    assert.equal(observedRequest?.width, 1024);
    assert.equal(observedRequest?.height, 768);
    assert.equal(observedRequest?.steps, 30);
    assert.ok(observedRequest?.signal instanceof AbortSignal);
  });
});

test('POST /api/images/generate rejects /model overrides that do not match configuration', async () => {
  await withTestServer({
    runtimeConfig: testRuntimeConfig({ imageGenerationEnabled: true }),
    configStore: await tempConfigStore(imageModel),
    ollamaClient: mockOllama([], [installedImageModel]),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a bear castle at sunset', model: 'other:image-model' })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'IMAGE_MODEL_OVERRIDE_NOT_ALLOWED');
  });
});
