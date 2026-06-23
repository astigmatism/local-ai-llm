#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"

APP_SERVICE="${APP_SERVICE:-app}"
OLLAMA_SERVICE="${OLLAMA_SERVICE:-ollama}"
RUNTIME_COMPOSE_FILE="${RUNTIME_COMPOSE_FILE:-compose.runtime.yaml}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"
PREWARM_WAIT_TIMEOUT_SECONDS="${PREWARM_WAIT_TIMEOUT_SECONDS:-900}"
DEPLOY_KEY_PATH="${DEPLOY_KEY_PATH:-$HOME/.ssh/id_ed25519_github_local_ai_llm}"

log() {
  printf '[local-ai-llm-legacy] %s\n' "$*"
}

fail() {
  printf '[local-ai-llm-legacy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

read_env_value() {
  local key="$1"
  local file="${2:-.env}"

  if [ ! -f "$file" ]; then
    return 1
  fi

  grep -E "^${key}=" "$file" | tail -n 1 | cut -d '=' -f 2-
}

read_env_or_default() {
  local key="$1"
  local default_value="$2"
  local value

  value="$(read_env_value "$key" .env 2>/dev/null || true)"

  if [ -n "$value" ]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$default_value"
  fi
}

compose() {
  if [ -f "$RUNTIME_COMPOSE_FILE" ]; then
    docker compose -f compose.yaml -f "$RUNTIME_COMPOSE_FILE" "$@"
  else
    docker compose -f compose.yaml "$@"
  fi
}

wait_for_container_health() {
  local container_id="$1"
  local label="$2"
  local deadline
  local status

  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(
      docker inspect "$container_id" \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        2>/dev/null || true
    )"

    log "$label health: ${status:-unknown}"

    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      return 0
    fi

    if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
      return 1
    fi

    sleep 2
  done

  return 1
}

wait_for_http_health() {
  local health_url="$1/health"
  local deadline

  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS "$health_url" >/tmp/local-ai-llm-legacy-health.json 2>/dev/null; then
      return 0
    fi

    sleep 2
  done

  return 1
}

build_base_url() {
  local bind_ip
  local web_port
  local host

  bind_ip="$(read_env_value WEB_BIND_IP .env || true)"
  web_port="$(read_env_value WEB_PORT .env || true)"

  host="${bind_ip:-127.0.0.1}"
  web_port="${web_port:-8001}"

  if [ "$host" = "0.0.0.0" ]; then
    host="127.0.0.1"
  fi

  printf 'http://%s:%s\n' "$host" "$web_port"
}

build_ollama_base_url() {
  local bind_ip
  local web_bind_ip
  local port
  local host

  bind_ip="$(read_env_value OLLAMA_BIND_IP .env || true)"
  web_bind_ip="$(read_env_value WEB_BIND_IP .env || true)"
  port="$(read_env_value OLLAMA_PORT .env || true)"

  host="${bind_ip:-${web_bind_ip:-192.168.1.21}}"
  port="${port:-11434}"

  if [ "$host" = "0.0.0.0" ]; then
    host="127.0.0.1"
  fi

  printf 'http://%s:%s\n' "$host" "$port"
}

image_name() {
  read_env_value LOCAL_AI_LLM_IMAGE .env 2>/dev/null || printf 'local-ai-llm-legacy:local\n'
}

should_rebuild_for_changed_files() {
  local changed_file

  if [ "${FULL_REBUILD:-false}" = "true" ]; then
    return 0
  fi

  if [ "${SKIP_REBUILD:-false}" = "true" ]; then
    return 1
  fi

  while IFS= read -r changed_file; do
    case "$changed_file" in
      Dockerfile|docker-entrypoint.sh|package.json|package-lock.json)
        return 0
        ;;
    esac
  done < /tmp/local-ai-llm-legacy-changed-files.txt

  return 1
}

set_default_model_if_present() {
  local base_url="$1"
  local model
  local model_json

  model="$(read_env_value DEFAULT_MODEL .env || true)"
  if [ -z "$model" ]; then
    log "DEFAULT_MODEL is empty; skipping app default model update"
    return 0
  fi

  model_json="$(python3 - "$model" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1]))
PY
)"

  log "Setting app default model: $model"
  curl -fsS \
    -H 'Content-Type: application/json' \
    -X POST "$base_url/config" \
    -d "{\"default_model\":${model_json}}" \
    >/tmp/local-ai-llm-legacy-config-response.json
}

pull_model_if_requested() {
  local model

  if [ "${PULL_MODEL_ON_RESTART:-false}" != "true" ]; then
    log "PULL_MODEL_ON_RESTART is not true; skipping model pull"
    return 0
  fi

  model="$(read_env_value DEFAULT_MODEL .env || true)"
  if [ -z "$model" ]; then
    fail "PULL_MODEL_ON_RESTART=true but DEFAULT_MODEL is empty"
  fi

  if compose exec -T "$OLLAMA_SERVICE" ollama show "$model" >/dev/null 2>&1; then
    log "Ollama model is already installed: $model"
    return 0
  fi

  log "Pulling Ollama model: $model"
  compose exec -T "$OLLAMA_SERVICE" ollama pull "$model"
}

prewarm_model_if_requested() {
  local base_url="$1"
  local model
  local model_json
  local deadline

  if [ "${PREWARM_MODEL_ON_RESTART:-false}" != "true" ]; then
    log "PREWARM_MODEL_ON_RESTART is not true; skipping model prewarm"
    return 0
  fi

  model="$(read_env_value DEFAULT_MODEL .env || true)"
  if [ -z "$model" ]; then
    fail "PREWARM_MODEL_ON_RESTART=true but DEFAULT_MODEL is empty"
  fi

  model_json="$(python3 - "$model" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1]))
PY
)"

  deadline=$((SECONDS + PREWARM_WAIT_TIMEOUT_SECONDS))
  log "Prewarming model through app API: $model"

  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS \
      -H 'Content-Type: application/json' \
      -X POST "$base_url/model/prewarm" \
      -d "{\"model\":${model_json}}" \
      >/tmp/local-ai-llm-legacy-prewarm-response.json 2>/tmp/local-ai-llm-legacy-prewarm-error.txt; then
      log "Model prewarm request completed"
      return 0
    fi

    log "Model prewarm is not ready yet; retrying"
    sleep 5
  done

  cat /tmp/local-ai-llm-legacy-prewarm-error.txt >&2 || true
  fail "Model prewarm did not complete before timeout"
}

cd "$APP_DIR"

log "Using application directory: $APP_DIR"
log "Using Compose services: $OLLAMA_SERVICE, $APP_SERVICE"

require_command git
require_command docker
require_command curl
require_command python3

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required: docker compose"

before_rev=""
after_rev=""

if [ -d .git ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "Tracked working tree changes are present. Commit, stash, or revert them before deploying."
  fi

  before_rev="$(git rev-parse HEAD)"

  if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -f "$DEPLOY_KEY_PATH" ]; then
    export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY_PATH -o IdentitiesOnly=yes"
    log "Using deploy key: $DEPLOY_KEY_PATH"
  fi

  log "Pulling latest git changes"
  git fetch --all --prune
  git pull --ff-only

  after_rev="$(git rev-parse HEAD)"

  if [ "$before_rev" != "$after_rev" ]; then
    git diff --name-only "$before_rev" "$after_rev" > /tmp/local-ai-llm-legacy-changed-files.txt
  else
    : > /tmp/local-ai-llm-legacy-changed-files.txt
  fi
else
  log "No .git directory found; skipping git pull for this source package"
  : > /tmp/local-ai-llm-legacy-changed-files.txt
fi

if [ ! -f .env ]; then
  fail ".env is missing. Run deploy-runtime.sh first so the GPU/model/runtime assignment is explicit."
fi

if [ ! -f "$RUNTIME_COMPOSE_FILE" ]; then
  fail "$RUNTIME_COMPOSE_FILE is missing. Run deploy-runtime.sh first so runtime GPU reservations are explicit."
fi

log "Active runtime settings"
grep -E '^(LOCAL_AI_LLM_PROJECT_NAME|LOCAL_AI_LLM_APP_CONTAINER_NAME|LOCAL_AI_LLM_OLLAMA_CONTAINER_NAME|WEB_BIND_IP|WEB_PORT|OLLAMA_BIND_IP|OLLAMA_PORT|GPU_SLOT_COUNT|GPU_SLOT_[0-3]|GPU_DEVICE_IDS|DEFAULT_MODEL|OLLAMA_IMAGE)=' .env || true

log "Rendering Compose configuration"
compose config >/tmp/local-ai-llm-legacy-compose.yml

selected_image="$(image_name)"
if ! docker image inspect "$selected_image" >/dev/null 2>&1; then
  log "Docker image is missing and must be built: $selected_image"
  FULL_REBUILD=true
fi

if should_rebuild_for_changed_files; then
  log "Building Docker image"
  build_args=()
  if [ "${NO_CACHE:-false}" = "true" ]; then
    build_args+=(--no-cache)
  fi
  compose build "${build_args[@]}" "$APP_SERVICE"
else
  log "Skipping Docker image build; app source is bind-mounted into the container"
  if [ -s /tmp/local-ai-llm-legacy-changed-files.txt ]; then
    log "Changed files since previous deploy:"
    sed 's/^/[local-ai-llm-legacy]   /' /tmp/local-ai-llm-legacy-changed-files.txt
  fi
fi

log "Recreating Ollama container"
compose up -d --force-recreate "$OLLAMA_SERVICE"

ollama_container_id="$(compose ps -q "$OLLAMA_SERVICE")"
if [ -z "$ollama_container_id" ]; then
  fail "Could not resolve container id for Compose service: $OLLAMA_SERVICE"
fi

log "Waiting for Ollama readiness"
if ! wait_for_container_health "$ollama_container_id" Ollama; then
  log "Recent Ollama logs:"
  compose logs --tail 120 "$OLLAMA_SERVICE" || true
  fail "Ollama did not become healthy"
fi

pull_model_if_requested

log "Recreating app container"
compose up -d --force-recreate "$APP_SERVICE"

app_container_id="$(compose ps -q "$APP_SERVICE")"
if [ -z "$app_container_id" ]; then
  fail "Could not resolve container id for Compose service: $APP_SERVICE"
fi

log "Waiting for app container readiness"
if ! wait_for_container_health "$app_container_id" App; then
  log "Recent app logs:"
  compose logs --tail 120 "$APP_SERVICE" || true
  fail "App container did not become healthy"
fi

base_url="${HEALTH_URL:-$(build_base_url)}"
log "Checking health endpoint: $base_url/health"
if ! wait_for_http_health "$base_url"; then
  log "Recent app logs:"
  compose logs --tail 120 "$APP_SERVICE" || true
  fail "App health endpoint did not become ready"
fi

set_default_model_if_present "$base_url"
prewarm_model_if_requested "$base_url"

ollama_base_url="${OLLAMA_HEALTH_URL:-$(build_ollama_base_url)}"
log "Checking published Ollama endpoint: $ollama_base_url/api/version"
curl -fsS "$ollama_base_url/api/version" >/tmp/local-ai-llm-legacy-ollama-version.json

log "Container status"
compose ps

log "Visible GPUs inside app container"
compose exec -T "$APP_SERVICE" nvidia-smi --query-gpu=index,uuid,name,memory.total,memory.free --format=csv || true

log "Visible GPUs inside Ollama container"
compose exec -T "$OLLAMA_SERVICE" nvidia-smi --query-gpu=index,uuid,name,memory.total,memory.free --format=csv || true

log "Installed Ollama models"
compose exec -T "$OLLAMA_SERVICE" ollama list || true

log "Running Ollama models"
compose exec -T "$OLLAMA_SERVICE" ollama ps || true

log "Update and restart complete"
log "Portal URL: $base_url/"
log "Published Ollama URL: $ollama_base_url/"
