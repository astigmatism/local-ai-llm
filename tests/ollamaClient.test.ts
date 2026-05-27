import assert from 'node:assert/strict';
import test from 'node:test';
import { OllamaClient } from '../src/services/ollamaClient.ts';

test('OllamaClient lists running models through /api/ps', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<[string, RequestInit]> = [];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push([String(url), init ?? {}]);
    return new Response(JSON.stringify({ models: [{ name: 'qwen3:14b' }] }), { status: 200 });
  };

  try {
    const client = new OllamaClient('http://ollama.test', 1000);
    const models = await client.listRunningModels();
    assert.deepEqual(models, [{ name: 'qwen3:14b' }]);
    assert.equal(calls[0]?.[0], 'http://ollama.test/api/ps');
    assert.equal(calls[0]?.[1].method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OllamaClient pre-warms model with stream false and keep_alive', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ done: true, done_reason: 'load' }), { status: 200 });
  };

  try {
    const client = new OllamaClient('http://ollama.test/', 1000);
    const result = await client.prewarmModel('qwen3:14b', -1, 1000);
    assert.equal(result.model, 'qwen3:14b');
    assert.deepEqual(bodies[0], { model: 'qwen3:14b', stream: false, keep_alive: -1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OllamaClient maps 404 responses to OLLAMA_MODEL_NOT_FOUND', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 });

  try {
    const client = new OllamaClient('http://ollama.test', 1000);
    await assert.rejects(client.prewarmModel('missing:model', -1), (error: unknown) => {
      return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'OLLAMA_MODEL_NOT_FOUND';
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
