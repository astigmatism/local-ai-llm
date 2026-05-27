const $ = (selector) => document.querySelector(selector);

const state = {
  health: null,
  config: null,
  runningModels: [],
  installedModels: [],
  gpus: []
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body?.error?.message || body?.detail?.[0]?.msg || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function formatBytesMiB(value) {
  return value === null || value === undefined ? 'n/a' : `${value.toLocaleString()} MiB`;
}

function formatNumber(value, suffix = '') {
  if (value === null || value === undefined) return 'n/a';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderKeyValues(values) {
  return `<dl class="kv">${values.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${value}</dd>`).join('')}</dl>`;
}

function renderHealth() {
  const target = $('#health-content');
  const health = state.health;
  if (!health) {
    target.textContent = 'No health data yet.';
    return;
  }

  const okClass = health.ok ? 'ok' : 'bad';
  const loadedClass = health.default_model_loaded ? 'ok' : 'warn';
  target.innerHTML = `
    <p><span class="status-pill ${okClass}">${health.ok ? 'OK' : 'Problem'}</span></p>
    ${renderKeyValues([
      ['Service', escapeHtml(health.service || 'Local AI LLM Monitor')],
      ['App version', escapeHtml(health.version || 'unknown')],
      ['Ollama', escapeHtml(health.ollama?.ok ? `reachable ${health.ollama?.version ? `(v${health.ollama.version})` : ''}` : `unreachable: ${health.error?.message || 'unknown error'}`)],
      ['Default model', `<code>${escapeHtml(health.default_model || '')}</code>`],
      ['Default loaded', `<span class="status-pill ${loadedClass}">${health.default_model_loaded ? 'Loaded' : 'Not loaded'}</span>`],
      ['Running model count', escapeHtml((health.running_models || []).length)]
    ])}`;
}

function renderConfig() {
  if (state.config?.config?.default_model) {
    $('#default-model-input').value = state.config.config.default_model;
  }
}

function renderModels(targetSelector, models, emptyMessage) {
  const target = $(targetSelector);
  if (!models || models.length === 0) {
    target.innerHTML = `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  target.innerHTML = `<div class="model-list">${models.map((model) => {
    const name = model.name || model.model || 'unnamed model';
    return `<article class="model-item">
      <h3><code>${escapeHtml(name)}</code></h3>
      ${renderKeyValues([
        ['Model', `<code>${escapeHtml(model.model || name)}</code>`],
        ['Size', model.size ? escapeHtml(`${model.size.toLocaleString()} bytes`) : 'n/a'],
        ['VRAM size', model.size_vram ? escapeHtml(`${model.size_vram.toLocaleString()} bytes`) : 'n/a'],
        ['Parameters', escapeHtml(model.details?.parameter_size || 'n/a')],
        ['Quantization', escapeHtml(model.details?.quantization_level || 'n/a')],
        ['Expires', escapeHtml(model.expires_at || model.modified_at || 'n/a')]
      ])}
    </article>`;
  }).join('')}</div>`;
}

function renderGpus() {
  const target = $('#gpu-list');
  const gpus = state.gpus;
  if (!gpus || gpus.length === 0) {
    target.innerHTML = '<p class="muted">No GPU data available.</p>';
    return;
  }

  target.innerHTML = gpus.map((gpu) => `<article class="gpu-card">
    <h3>GPU ${escapeHtml(gpu.index)}: ${escapeHtml(gpu.name)}</h3>
    <p class="muted">${escapeHtml(gpu.uuid || 'UUID unavailable')} | Driver ${escapeHtml(gpu.driver_version || 'n/a')}</p>
    <div class="metrics">
      <div class="metric"><span>Memory used</span><strong>${formatBytesMiB(gpu.memory_used_mib)}</strong></div>
      <div class="metric"><span>Memory free</span><strong>${formatBytesMiB(gpu.memory_free_mib)}</strong></div>
      <div class="metric"><span>Memory total</span><strong>${formatBytesMiB(gpu.memory_total_mib)}</strong></div>
      <div class="metric"><span>GPU utilization</span><strong>${formatNumber(gpu.utilization_gpu_percent, '%')}</strong></div>
      <div class="metric"><span>Temperature</span><strong>${formatNumber(gpu.temperature_c, ' °C')}</strong></div>
      <div class="metric"><span>Power draw / limit</span><strong>${formatNumber(gpu.power_draw_w, ' W')} / ${formatNumber(gpu.power_limit_w, ' W')}</strong></div>
    </div>
    ${gpu.warnings?.length ? `<p class="hint">Warnings: ${escapeHtml(gpu.warnings.join(', '))}</p>` : ''}
  </article>`).join('');
}

function renderAll() {
  renderHealth();
  renderConfig();
  renderModels('#running-models', state.runningModels, 'No models are currently loaded in Ollama memory.');
  renderModels('#installed-models', state.installedModels, 'No installed models returned by Ollama.');
  renderGpus();
}

async function refresh() {
  const feedback = $('#operation-feedback');
  try {
    const [health, config, running, installed, gpus] = await Promise.allSettled([
      fetchJson('/health'),
      fetchJson('/config'),
      fetchJson('/models/running'),
      fetchJson('/models/installed'),
      fetchJson('/gpus')
    ]);

    if (health.status === 'fulfilled') state.health = health.value;
    if (config.status === 'fulfilled') state.config = config.value;
    if (running.status === 'fulfilled') state.runningModels = running.value.models || [];
    if (installed.status === 'fulfilled') state.installedModels = installed.value.models || [];
    if (gpus.status === 'fulfilled') state.gpus = gpus.value.gpus || [];

    for (const result of [health, config, running, installed, gpus]) {
      if (result.status === 'rejected') {
        console.warn(result.reason);
      }
    }
    renderAll();
  } catch (error) {
    feedback.className = 'feedback error';
    feedback.textContent = error.message;
  }
}

function setFeedback(message, ok = true) {
  const feedback = $('#operation-feedback');
  feedback.className = `feedback ${ok ? 'ok' : 'error'}`;
  feedback.textContent = message;
}

$('#refresh-button').addEventListener('click', refresh);

$('#config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const defaultModel = $('#default-model-input').value.trim();
  try {
    const result = await fetchJson('/config', {
      method: 'POST',
      body: JSON.stringify({ default_model: defaultModel })
    });
    state.config = result;
    setFeedback(`Saved default model ${defaultModel}.`);
    await refresh();
  } catch (error) {
    setFeedback(`Unable to save default model: ${error.message}`, false);
  }
});

$('#load-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const model = $('#load-model-input').value.trim();
  const makeDefault = $('#make-default-input').checked;
  try {
    setFeedback(`Loading ${model}...`);
    const result = await fetchJson('/model/load', {
      method: 'POST',
      body: JSON.stringify({ model, make_default: makeDefault })
    });
    setFeedback(`${result.model} pre-warmed. Loaded: ${result.loaded ? 'yes' : 'verification pending'}.`);
    await refresh();
  } catch (error) {
    setFeedback(`Unable to load model: ${error.message}`, false);
  }
});

$('#prewarm-default-button').addEventListener('click', async () => {
  try {
    const defaultModel = $('#default-model-input').value.trim();
    setFeedback(`Pre-warming ${defaultModel || 'default model'}...`);
    const result = await fetchJson('/model/prewarm', {
      method: 'POST',
      body: JSON.stringify(defaultModel ? { model: defaultModel } : {})
    });
    setFeedback(`${result.model} pre-warmed. Loaded: ${result.loaded ? 'yes' : 'verification pending'}.`);
    await refresh();
  } catch (error) {
    setFeedback(`Unable to pre-warm model: ${error.message}`, false);
  }
});

refresh();
setInterval(refresh, 10000);
