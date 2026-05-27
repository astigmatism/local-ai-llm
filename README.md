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
- Persistent local config file for the default model.
- Startup pre-warm support for the configured default model.
- NVIDIA multi-GPU telemetry through a fixed `nvidia-smi --query-gpu` command.
- Deployment/update and source-compression scripts.
- Tests that run without real GPUs or Ollama.

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
```

`qwen3:14b` is an example only. Pull and configure a model that fits the host's GPUs and operating needs.

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
