import assert from 'node:assert/strict';
import test from 'node:test';
import { mockGpuService, mockOllama, testRuntimeConfig, withTestServer } from './helpers.ts';
import type { OllamaChatRequest } from '../src/types.ts';

const loadedModel = 'qwen3.6:loaded-test';

test('POST /api/assistant/chat uses exactly one currently loaded Ollama model server-side', async () => {
  let observedRequest: OllamaChatRequest | null = null;

  await withTestServer({
    runtimeConfig: testRuntimeConfig({ ollamaRequestTimeoutMs: 4321 }),
    ollamaClient: mockOllama(
      [{ name: loadedModel, model: loadedModel }],
      [],
      undefined,
      undefined,
      { capabilities: ['completion'] },
      (request) => {
        observedRequest = request;
      },
      { model: loadedModel, text: 'voice test ok', metadata: { done: true, total_duration: 123 } }
    ),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Reply with exactly: voice test ok',
        system_prompt: 'You are a concise voice assistant.'
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.text, 'voice test ok');
    assert.equal(body.model, loadedModel);
    assert.equal(body.metadata.endpoint, '/api/chat');
    assert.equal(body.metadata.loadedModelCount, 1);
    assert.equal(observedRequest?.model, loadedModel);
    assert.equal(observedRequest?.timeoutMs, 4321);
    assert.deepEqual(observedRequest?.messages, [
      { role: 'system', content: 'You are a concise voice assistant.' },
      { role: 'user', content: 'Reply with exactly: voice test ok' }
    ]);
    assert.ok(observedRequest?.signal instanceof AbortSignal);
  });
});

test('POST /api/assistant/chat fails closed when no Ollama model is loaded', async () => {
  let chatCalled = false;

  await withTestServer({
    ollamaClient: mockOllama([], [], undefined, undefined, { capabilities: ['completion'] }, () => {
      chatCalled = true;
    }),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    });

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'ASSISTANT_MODEL_NOT_LOADED');
  });

  assert.equal(chatCalled, false);
});

test('POST /api/assistant/chat fails closed when multiple Ollama models are loaded', async () => {
  let chatCalled = false;

  await withTestServer({
    ollamaClient: mockOllama([
      { name: 'first:model', model: 'first:model' },
      { name: 'second:model', model: 'second:model' }
    ], [], undefined, undefined, { capabilities: ['completion'] }, () => {
      chatCalled = true;
    }),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    });

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'ASSISTANT_MODEL_AMBIGUOUS');
    assert.equal(body.error.details.loadedModels.length, 2);
  });

  assert.equal(chatCalled, false);
});

test('POST /api/assistant/chat rejects client-side model selection', async () => {
  let chatCalled = false;

  await withTestServer({
    ollamaClient: mockOllama([{ name: loadedModel, model: loadedModel }], [], undefined, undefined, { capabilities: ['completion'] }, () => {
      chatCalled = true;
    }),
    gpuService: mockGpuService()
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello', model: 'do-not-use:this' })
    });

    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.detail[0].loc[1], 'model');
    assert.equal(body.detail[0].type, 'extra_forbidden');
  });

  assert.equal(chatCalled, false);
});
