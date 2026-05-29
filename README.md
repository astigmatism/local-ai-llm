# Local AI LLM Monitor

A bare-metal local AI appliance project for an Ubuntu 24 Server host with NVIDIA GPUs, Ollama, and a Node-based monitor/control portal compatible with the observed legacy `Local AI LLM Monitor` API.

The repository is intended for this host/project:

```text
https://github.com/astigmatism/local-ai-llm
```

## What this provides

- Node 24-compatible TypeScript management service on `0.0.0.0:8000`, using Node's built-in HTTP server and native TypeScript type stripping.
- Web portal for service health, Ollama status, default model management, model pre-warm controls, running/installed models, and all NVIDIA GPUs.
- Compatibility API endpoints:
  - `GET /health`
  - `GET /gpu`
  - `POST /model/load`
- New API endpoints:
  - `GET /gpus`
  - `GET /models/running`
  - `GET /models/installed`
  - `GET /config`
  - `POST /config`
  - `POST /model/prewarm`
  - `GET /openapi.json`
  - `GET /api/capabilities`
  - `POST /api/images/generate`
- Persistent local config file for the default model.
- Startup pre-warm support for the configured default model.
- NVIDIA multi-GPU telemetry through a fixed `nvidia-smi --query-gpu` command.
- Deployment/update and source-compression scripts.
- Tests that run without real GPUs or Ollama.
- Optional image-generation API for configured Ollama image-generation-capable models.

## Quick start for development

```bash
cp .env.example .env
npm ci
npm run validate
npm run build
npm start
```

Open the portal:

```text
http://127.0.0.1:8000/
```

API checks:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/gpus
curl -X POST http://127.0.0.1:8000/model/load \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3:14b","make_default":false}'
```

## Production install order

Start with [`docs/README.md`](docs/README.md), then follow the numbered documents in order.

## Important defaults

The `.env.example` file uses:

```text
PORT=8000
HOST=0.0.0.0
OLLAMA_BASE_URL=http://127.0.0.1:11434
CONFIG_PATH=./config/local-ai-llm.json
DEFAULT_MODEL=qwen3:14b
PREWARM_DEFAULT_MODEL_ON_START=true
IMAGE_GENERATION_ENABLED=false
IMAGE_GENERATION_MODEL=
```

`qwen3:14b` is an example only. Pull and configure a model that fits the host's GPUs and operating needs.

## Optional image generation

Image generation is disabled by default because not every Ollama model can generate images. To enable it, pull an Ollama model that explicitly supports image generation, then configure this service:

```env
IMAGE_GENERATION_ENABLED=true
IMAGE_GENERATION_MODEL=<pulled-image-generation-model>
IMAGE_GENERATION_TIMEOUT_MS=600000
IMAGE_GENERATION_MAX_PROMPT_CHARS=4000
```

The capability endpoint reports whether image generation is configured and whether the configured model appears in Ollama's installed-model list:

```bash
curl http://127.0.0.1:8000/api/capabilities
```

When available, the private image endpoint accepts a prompt and optional experimental size/step parameters and calls Ollama `POST /api/generate` with `stream:false` using the configured image model:

```bash
curl -X POST http://127.0.0.1:8000/api/images/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"A bear castle at sunset","options":{"width":1024,"height":1024,"steps":30}}'
```

The response returns base64 image data and metadata to the Bear Castle AI gateway. This service does not store generated files; the gateway is responsible for authenticated conversation persistence and image serving. If the model is not configured, not installed, or Ollama returns no image data, the endpoint returns a clear error instead of falling back to text generation.

## Legacy API compatibility

`GET /gpu` intentionally returns only one primary GPU in the older single-GPU response shape. For new integrations, use `GET /gpus`, which returns every detected NVIDIA GPU with index, UUID, memory, utilization, temperature, and power telemetry.

## Scripts

```bash
./update-and-restart.sh
./compress-source.sh ~/Desktop
```

`update-and-restart.sh` supports systemd operation and defaults to the `local-ai-llm` service name. Override it with:

```bash
SERVICE_NAME=my-service-name ./update-and-restart.sh
```

`compress-source.sh` writes `local-AI-LLM-<timestamp>.zip` and excludes dependencies, build artifacts, local environment files, logs, and generated config.
