#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
APP_SERVICE="${APP_SERVICE:-app}"
OLLAMA_SERVICE="${OLLAMA_SERVICE:-ollama}"
RUNTIME_COMPOSE_FILE="${RUNTIME_COMPOSE_FILE:-compose.runtime.yaml}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"
PREWARM_WAIT_TIMEOUT_SECONDS="${PREWARM_WAIT_TIMEOUT_SECONDS:-900}"
MAX_GPU_SLOTS="${MAX_GPU_SLOTS:-4}"

log() {
  printf '[local-ai-llm-legacy] %s\n' "$*"
}

fail() {
  printf '[local-ai-llm-legacy] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  ./deploy-runtime.sh list
  ./deploy-runtime.sh plan --gpu-device-ids <GPU-UUID[,GPU-UUID...]> --model <ollama-model>
  ./deploy-runtime.sh deploy --gpu-device-ids <GPU-UUID[,GPU-UUID...]> --model <ollama-model>
  ./deploy-runtime.sh <GPU-UUID[,GPU-UUID...]> <ollama-model>
  ./deploy-runtime.sh help

GPU assignment:
  The LLM runtime accepts 1-4 GPU slots by default. Set MAX_GPU_SLOTS to
  lower or raise that cap for a specific host or service contract.

  Deployment accepts full NVIDIA GPU UUIDs only, for example:
    GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

  Multiple GPU UUIDs may be passed as one comma-separated --gpu-device-ids
  value. Repeated --gpu-device-id values are also accepted when each value is
  a full GPU UUID.

  Do not pass GPU numeric indexes, GPU model names, friendly aliases, or "all".
  A scheduler or operator should run list/discovery first, select installed GPU
  UUIDs, and then pass those UUIDs to plan or deploy.

Model argument:
  Pass an Ollama model name, such as <ollama-model>, a valid Ollama model name with an optional tag.
  The script writes it as DEFAULT_MODEL and pulls it unless PULL_MODEL_ON_DEPLOY=false.

Examples:
  ./deploy-runtime.sh list
  ./deploy-runtime.sh plan --gpu-device-ids GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa --model <ollama-model>
  ./deploy-runtime.sh deploy --gpu-device-ids GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb --model <ollama-model>
  ./deploy-runtime.sh deploy --gpu-device-id GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa --gpu-device-id GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb --model <ollama-model>
  ./deploy-runtime.sh GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa <ollama-model>

What deploy does:
  1. Validates requested GPU UUIDs against live host nvidia-smi inventory.
  2. Generates .env runtime state with GPU_SLOT_COUNT, GPU_SLOT_0..3, GPU_DEVICE_IDS, and DEFAULT_MODEL.
  3. Generates compose.runtime.yaml with a YAML device_ids list for the selected GPU UUIDs.
  4. Creates host runtime directories under AI_ROOT.
  5. Renders and validates Docker Compose configuration.
  6. Starts Ollama with the selected GPU set.
  7. Pulls the selected model unless PULL_MODEL_ON_DEPLOY=false.
  8. Builds the small Node image only if missing or FULL_REBUILD=true.
  9. Recreates the Node portal container.
  10. Waits for health, sets the app default model, and optionally prewarms it.
  11. Prints service status, visible GPUs, installed models, and running models.

What plan does:
  1. Validates requested GPU UUIDs against live host nvidia-smi inventory.
  2. Validates the requested Ollama model name format.
  3. Prints selected runtime values, GPU slot count, and selected GPU memory.
  4. Makes no filesystem, Docker, Compose, model-pull, or API changes.

Environment overrides:
  APP_DIR=/path/to/repo
  AI_ROOT=/home/astigmatism/ai
  LLM_MODEL_DIR=/home/astigmatism/ai/models/llm
  WEB_BIND_IP=192.168.1.21
  WEB_PORT=8001
  MAX_GPU_SLOTS=4
  PULL_MODEL_ON_DEPLOY=true
  PREWARM_MODEL_ON_DEPLOY=true
  FULL_REBUILD=false
  HEALTH_TIMEOUT_SECONDS=300
  PREWARM_WAIT_TIMEOUT_SECONDS=900
USAGE
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

split_gpu_device_ids() {
  local raw="$1"
  local item
  local trimmed

  IFS=',' read -ra parts <<< "$raw"
  for item in "${parts[@]}"; do
    trimmed="$(printf '%s' "$item" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    if [ -n "$trimmed" ]; then
      GPU_DEVICE_ID_INPUTS+=("$trimmed")
    fi
  done
}

parse_mode_and_args() {
  MODE="${1:-help}"
  GPU_DEVICE_ID_INPUTS=()
  MODEL=""

  case "$MODE" in
    list|help|-h|--help)
      return 0
      ;;
    plan|deploy)
      shift
      ;;
    *)
      if [ "$#" -eq 2 ]; then
        MODE="deploy"
        split_gpu_device_ids "$1"
        MODEL="$2"
        return 0
      fi
      MODE="help"
      return 0
      ;;
  esac

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --gpu-device-ids)
        [ "$#" -ge 2 ] || fail "--gpu-device-ids requires a value"
        split_gpu_device_ids "$2"
        shift 2
        ;;
      --gpu-device-id)
        [ "$#" -ge 2 ] || fail "--gpu-device-id requires a value"
        split_gpu_device_ids "$2"
        shift 2
        ;;
      --gpus|--gpu)
        fail "Use --gpu-device-ids with full NVIDIA GPU UUID values. Numeric indexes, model names, friendly aliases, and 'all' are not accepted."
        ;;
      --model)
        [ "$#" -ge 2 ] || fail "--model requires a value"
        MODEL="$2"
        shift 2
        ;;
      --no-pull)
        export PULL_MODEL_ON_DEPLOY=false
        shift
        ;;
      --no-prewarm)
        export PREWARM_MODEL_ON_DEPLOY=false
        shift
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}


list_gpus() {
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "nvidia-smi not found on host."
    return 0
  fi

  echo "Detected host GPUs:"
  nvidia-smi --query-gpu=index,uuid,name,memory.total,memory.free --format=csv
  echo
  echo "Deploy inputs must use the uuid value exactly. Do not use index, name, aliases, or all as deploy arguments."
}

validate_gpu_device_ids() {
  python3 - "$MAX_GPU_SLOTS" "${GPU_DEVICE_ID_INPUTS[@]}" <<'PY'
import csv
import subprocess
import sys

max_slots = int(sys.argv[1])
requested_ids = [value.strip() for value in sys.argv[2:] if value.strip()]

try:
    raw = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=index,uuid,name,memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ],
        text=True,
    )
except FileNotFoundError:
    print("nvidia-smi not found on host", file=sys.stderr)
    sys.exit(2)
except subprocess.CalledProcessError as exc:
    print(f"nvidia-smi failed: {exc}", file=sys.stderr)
    sys.exit(2)

gpus = []
gpu_by_uuid_lower = {}
for row in csv.reader(raw.splitlines()):
    if len(row) < 5:
        continue

    index = row[0].strip()
    uuid = row[1].strip()
    name = row[2].strip()
    memory_total = row[3].strip()
    memory_free = row[4].strip()

    gpu = {
        "index": index,
        "uuid": uuid,
        "name": name,
        "memory_total": memory_total,
        "memory_free": memory_free,
    }
    gpus.append(gpu)
    gpu_by_uuid_lower[uuid.lower()] = gpu

if not gpus:
    print("No GPUs were returned by nvidia-smi", file=sys.stderr)
    sys.exit(2)

if not requested_ids:
    print("At least one GPU UUID is required", file=sys.stderr)
    sys.exit(1)

if len(requested_ids) > max_slots:
    print(f"Selected {len(requested_ids)} GPUs, but MAX_GPU_SLOTS is {max_slots}", file=sys.stderr)
    sys.exit(1)

selected = []
seen = set()
for requested in requested_ids:
    if requested.lower() == "all":
        print("GPU value 'all' is not accepted. Pass explicit GPU UUIDs discovered from list mode.", file=sys.stderr)
        sys.exit(1)

    if not requested.startswith("GPU-"):
        print(
            "GPU assignment must use full NVIDIA GPU UUIDs beginning with GPU-. "
            f"Received: {requested}",
            file=sys.stderr,
        )
        print("Available GPU UUIDs:", file=sys.stderr)
        for gpu in gpus:
            print(
                f"  {gpu['uuid']} | index={gpu['index']} | {gpu['name']} | "
                f"total={gpu['memory_total']} MiB | free={gpu['memory_free']} MiB",
                file=sys.stderr,
            )
        sys.exit(1)

    if any(ch.isspace() for ch in requested):
        print(f"GPU UUID must not contain whitespace: {requested}", file=sys.stderr)
        sys.exit(1)

    key = requested.lower()
    if key in seen:
        print(f"Duplicate GPU UUID requested: {requested}", file=sys.stderr)
        sys.exit(1)

    match = gpu_by_uuid_lower.get(key)
    if match is None:
        print(f"GPU UUID is not installed on this host: {requested}", file=sys.stderr)
        print("Available GPU UUIDs:", file=sys.stderr)
        for gpu in gpus:
            print(
                f"  {gpu['uuid']} | index={gpu['index']} | {gpu['name']} | "
                f"total={gpu['memory_total']} MiB | free={gpu['memory_free']} MiB",
                file=sys.stderr,
            )
        sys.exit(1)

    selected.append(match)
    seen.add(key)

if len(selected) < 1:
    print("At least one unique GPU must be selected", file=sys.stderr)
    sys.exit(1)

for gpu in selected:
    print(
        f"{gpu['uuid']}\t{gpu['index']}\t{gpu['name']}\t"
        f"{gpu['memory_total']}\t{gpu['memory_free']}"
    )
PY
}

validate_model_name() {
  local model="$1"

  if [[ ! "$model" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$ ]]; then
    fail "Invalid Ollama model name: $model"
  fi
}

list_local_model_files() {
  local llm_model_dir="$1"

  echo
  echo "Loose local LLM model directory:"
  echo "  $llm_model_dir"

  if [ ! -d "$llm_model_dir" ]; then
    echo "  missing"
    return 0
  fi

  find "$llm_model_dir" -maxdepth 4 -type f \
    \( -name '*.gguf' -o -name 'Modelfile' \) \
    -printf '  %p\t%k KB\n' | sort | sed -n '1,160p'
}

list_installed_models() {
  echo
  echo "Installed Ollama models for this Compose project:"

  if [ -f compose.yaml ] && compose ps -q "$OLLAMA_SERVICE" >/tmp/local-ai-llm-legacy-ollama-container-id.txt 2>/dev/null \
    && [ -s /tmp/local-ai-llm-legacy-ollama-container-id.txt ]; then
    if compose exec -T "$OLLAMA_SERVICE" ollama list 2>/dev/null; then
      return 0
    fi
  fi

  echo "  Ollama is not running yet for this project, or no model list is available."
}

write_env_file() {
  local default_model="$1"
  local ai_root="$2"
  local llm_model_dir="$3"
  local tmp_file
  local gpu_csv
  local slot_value
  local i

  gpu_csv="$(IFS=','; printf '%s' "${GPU_UUIDS[*]}")"
  tmp_file="$(mktemp)"

  {
    echo "# Generated by deploy-runtime.sh"
    echo "# Do not edit GPU/model assignment here by hand; rerun deploy-runtime.sh."
    echo

    printf 'LOCAL_AI_LLM_PROJECT_NAME=%s\n' "$(read_env_or_default LOCAL_AI_LLM_PROJECT_NAME local-ai-llm-legacy)"
    printf 'LOCAL_AI_LLM_APP_CONTAINER_NAME=%s\n' "$(read_env_or_default LOCAL_AI_LLM_APP_CONTAINER_NAME local-ai-llm-legacy)"
    printf 'LOCAL_AI_LLM_OLLAMA_CONTAINER_NAME=%s\n' "$(read_env_or_default LOCAL_AI_LLM_OLLAMA_CONTAINER_NAME local-ai-llm-legacy-ollama)"
    printf 'LOCAL_AI_LLM_IMAGE=%s\n' "$(read_env_or_default LOCAL_AI_LLM_IMAGE local-ai-llm-legacy:local)"
    printf 'OLLAMA_IMAGE=%s\n' "$(read_env_or_default OLLAMA_IMAGE ollama/ollama:latest)"
    echo

    printf 'AI_ROOT=%s\n' "$ai_root"
    printf 'LLM_MODEL_DIR=%s\n' "$llm_model_dir"
    printf 'WEB_BIND_IP=%s\n' "${WEB_BIND_IP:-$(read_env_or_default WEB_BIND_IP 192.168.1.21)}"
    printf 'WEB_PORT=%s\n' "${WEB_PORT:-$(read_env_or_default WEB_PORT 8001)}"
    echo

    printf 'GPU_SLOT_COUNT=%s\n' "${#GPU_UUIDS[@]}"
    for i in 0 1 2 3; do
      slot_value=""
      if [ "$i" -lt "${#GPU_UUIDS[@]}" ]; then
        slot_value="${GPU_UUIDS[$i]}"
      fi
      printf 'GPU_SLOT_%s=%s\n' "$i" "$slot_value"
    done
    printf 'GPU_DEVICE_IDS=%s\n' "$gpu_csv"
    printf 'CUDA_VISIBLE_DEVICES=%s\n' "$gpu_csv"
    echo

    printf 'DEFAULT_MODEL=%s\n' "$default_model"
    echo

    echo "OLLAMA_BASE_URL=http://ollama:11434"
    printf 'OLLAMA_REQUEST_TIMEOUT_MS=%s\n' "${OLLAMA_REQUEST_TIMEOUT_MS:-$(read_env_or_default OLLAMA_REQUEST_TIMEOUT_MS 1200000)}"
    echo

    echo "CONFIG_PATH=/app/config/local-ai-llm.json"
    echo "PREWARM_DEFAULT_MODEL_ON_START=false"
    printf 'PREWARM_TIMEOUT_MS=%s\n' "${PREWARM_TIMEOUT_MS:-$(read_env_or_default PREWARM_TIMEOUT_MS 900000)}"
    printf 'PREWARM_KEEP_ALIVE=%s\n' "${PREWARM_KEEP_ALIVE:-$(read_env_or_default PREWARM_KEEP_ALIVE -1)}"
    echo

    printf 'OLLAMA_KEEP_ALIVE=%s\n' "${OLLAMA_KEEP_ALIVE:-$(read_env_or_default OLLAMA_KEEP_ALIVE -1)}"
    printf 'OLLAMA_NUM_PARALLEL=%s\n' "${OLLAMA_NUM_PARALLEL:-$(read_env_or_default OLLAMA_NUM_PARALLEL 1)}"
    printf 'OLLAMA_MAX_LOADED_MODELS=%s\n' "${OLLAMA_MAX_LOADED_MODELS:-$(read_env_or_default OLLAMA_MAX_LOADED_MODELS 1)}"
    echo

    printf 'IMAGE_GENERATION_ENABLED=%s\n' "${IMAGE_GENERATION_ENABLED:-$(read_env_or_default IMAGE_GENERATION_ENABLED false)}"
    printf 'IMAGE_GENERATION_TIMEOUT_MS=%s\n' "${IMAGE_GENERATION_TIMEOUT_MS:-$(read_env_or_default IMAGE_GENERATION_TIMEOUT_MS 600000)}"
    printf 'IMAGE_GENERATION_MAX_PROMPT_CHARS=%s\n' "${IMAGE_GENERATION_MAX_PROMPT_CHARS:-$(read_env_or_default IMAGE_GENERATION_MAX_PROMPT_CHARS 4000)}"
    echo

    printf 'GPU_QUERY_TIMEOUT_MS=%s\n' "${GPU_QUERY_TIMEOUT_MS:-$(read_env_or_default GPU_QUERY_TIMEOUT_MS 5000)}"
    printf 'LOG_LEVEL=%s\n' "${LOG_LEVEL:-$(read_env_or_default LOG_LEVEL info)}"
  } > "$tmp_file"

  mv "$tmp_file" .env
}

write_runtime_compose_file() {
  local gpu_csv
  local uuid

  gpu_csv="$(IFS=','; printf '%s' "${GPU_UUIDS[*]}")"

  {
    echo "# Generated by deploy-runtime.sh"
    echo "# This file contains runtime GPU reservations for the current deployment."
    echo "services:"
    for service in "$OLLAMA_SERVICE" "$APP_SERVICE"; do
      echo "  ${service}:"
      echo "    environment:"
      echo "      CUDA_VISIBLE_DEVICES: \"${gpu_csv}\""
      echo "      NVIDIA_VISIBLE_DEVICES: \"${gpu_csv}\""
      echo "      NVIDIA_DRIVER_CAPABILITIES: compute,utility"
      echo "    deploy:"
      echo "      resources:"
      echo "        reservations:"
      echo "          devices:"
      echo "            - driver: nvidia"
      echo "              device_ids:"
      for uuid in "${GPU_UUIDS[@]}"; do
        echo "                - \"${uuid}\""
      done
      echo "              capabilities: [gpu]"
    done
  } > "$RUNTIME_COMPOSE_FILE"
}

ensure_runtime_dirs() {
  local ai_root="$1"
  local llm_model_dir="$2"

  mkdir -p \
    "$ai_root/models/ollama" \
    "$ai_root/cache/local-ai-llm-legacy" \
    "$llm_model_dir" \
    ./config
}

image_name() {
  read_env_value LOCAL_AI_LLM_IMAGE .env 2>/dev/null || printf 'local-ai-llm-legacy:local\n'
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

ensure_app_image() {
  local selected_image

  selected_image="$(image_name)"

  if [ "${FULL_REBUILD:-false}" = "true" ]; then
    log "FULL_REBUILD=true; building Docker image: $selected_image"
    compose build "$APP_SERVICE"
    return 0
  fi

  if docker image inspect "$selected_image" >/dev/null 2>&1; then
    log "Docker image exists: $selected_image"
  else
    log "Docker image is missing; building: $selected_image"
    compose build "$APP_SERVICE"
  fi
}

is_model_installed() {
  local model="$1"
  compose exec -T "$OLLAMA_SERVICE" ollama show "$model" >/dev/null 2>&1
}

pull_model_if_needed() {
  local model="$1"

  if [ "${PULL_MODEL_ON_DEPLOY:-true}" != "true" ]; then
    log "PULL_MODEL_ON_DEPLOY is not true; skipping model pull"
    return 0
  fi

  if is_model_installed "$model"; then
    log "Ollama model is already installed: $model"
    return 0
  fi

  log "Pulling Ollama model: $model"
  compose exec -T "$OLLAMA_SERVICE" ollama pull "$model"
}

json_string() {
  python3 - "$1" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1]))
PY
}

set_default_model() {
  local base_url="$1"
  local model="$2"
  local model_json

  model_json="$(json_string "$model")"

  log "Setting app default model: $model"
  curl -fsS \
    -H 'Content-Type: application/json' \
    -X POST "$base_url/config" \
    -d "{\"default_model\":${model_json}}" \
    >/tmp/local-ai-llm-legacy-config-response.json
}

prewarm_model_if_requested() {
  local base_url="$1"
  local model="$2"
  local model_json
  local deadline

  if [ "${PREWARM_MODEL_ON_DEPLOY:-true}" != "true" ]; then
    log "PREWARM_MODEL_ON_DEPLOY is not true; skipping model prewarm"
    return 0
  fi

  model_json="$(json_string "$model")"
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

print_plan() {
  local model="$1"
  local ai_root="$2"
  local llm_model_dir="$3"
  local total_mib=0
  local largest_mib=0
  local memory
  local i

  for memory in "${GPU_MEMORY_MIB[@]}"; do
    total_mib=$((total_mib + memory))
    if [ "$memory" -gt "$largest_mib" ]; then
      largest_mib="$memory"
    fi
  done

  echo "Deployment plan:"
  echo "  project:      $(read_env_or_default LOCAL_AI_LLM_PROJECT_NAME local-ai-llm-legacy)"
  echo "  app service:  $APP_SERVICE"
  echo "  model service:$OLLAMA_SERVICE"
  echo "  default model:$model"
  echo "  web bind:     ${WEB_BIND_IP:-$(read_env_or_default WEB_BIND_IP 192.168.1.21)}:${WEB_PORT:-$(read_env_or_default WEB_PORT 8001)}"
  echo "  AI_ROOT:      $ai_root"
  echo "  LLM_MODEL_DIR:$llm_model_dir"
  echo "  GPU slots:    ${#GPU_UUIDS[@]} of max $MAX_GPU_SLOTS"
  echo "  GPU memory:   total ${total_mib} MiB; largest single GPU ${largest_mib} MiB"
  for i in "${!GPU_UUIDS[@]}"; do
    echo "    slot $i: ${GPU_UUIDS[$i]} | index ${GPU_INDEXES[$i]} | ${GPU_NAMES[$i]} | total ${GPU_MEMORY_MIB[$i]} MiB | free ${GPU_MEMORY_FREE_MIB[$i]} MiB"
  done
  echo
  echo "Note: model fit is validated by pull/prewarm/runtime checks. This script does not assume remote Ollama model VRAM requirements before the model is installed."
}

run_list_mode() {
  local ai_root
  local llm_model_dir

  ai_root="${AI_ROOT:-$(read_env_or_default AI_ROOT /home/astigmatism/ai)}"
  llm_model_dir="${LLM_MODEL_DIR:-$(read_env_or_default LLM_MODEL_DIR "$ai_root/models/llm")}"

  require_command nvidia-smi
  list_gpus

  echo
  echo "Runtime paths:"
  echo "  AI_ROOT:      $ai_root"
  echo "  Ollama store: $ai_root/models/ollama"
  echo "  LLM files:    $llm_model_dir"

  list_installed_models
  list_local_model_files "$llm_model_dir"

  echo
  echo "Currently bound local AI ports:"
  ss -tulpn 2>/dev/null | grep -E ':(8000|8001|8002|8003|8004|11434)\b' || true
}

cd "$APP_DIR"
parse_mode_and_args "$@"

case "$MODE" in
  list)
    run_list_mode
    exit 0
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
esac

if [ "${#GPU_DEVICE_ID_INPUTS[@]}" -lt 1 ]; then
  usage
  exit 2
fi

if [ -z "$MODEL" ]; then
  usage
  exit 2
fi

log "Using application directory: $APP_DIR"
log "Using Compose services: $OLLAMA_SERVICE, $APP_SERVICE"

require_command docker
require_command nvidia-smi
require_command python3
require_command curl

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required: docker compose"

validate_model_name "$MODEL"

resolved_gpu_file="$(mktemp)"
if ! validate_gpu_device_ids > "$resolved_gpu_file"; then
  rm -f "$resolved_gpu_file"
  exit 1
fi
mapfile -t RESOLVED_GPU_LINES < "$resolved_gpu_file"
rm -f "$resolved_gpu_file"

GPU_UUIDS=()
GPU_INDEXES=()
GPU_NAMES=()
GPU_MEMORY_MIB=()
GPU_MEMORY_FREE_MIB=()
for line in "${RESOLVED_GPU_LINES[@]}"; do
  IFS=$'\t' read -r uuid index name memory memory_free <<< "$line"
  GPU_UUIDS+=("$uuid")
  GPU_INDEXES+=("$index")
  GPU_NAMES+=("$name")
  GPU_MEMORY_MIB+=("$memory")
  GPU_MEMORY_FREE_MIB+=("$memory_free")
done

ai_root="${AI_ROOT:-$(read_env_or_default AI_ROOT /home/astigmatism/ai)}"
llm_model_dir="${LLM_MODEL_DIR:-$(read_env_or_default LLM_MODEL_DIR "$ai_root/models/llm")}"

print_plan "$MODEL" "$ai_root" "$llm_model_dir"

if [ "$MODE" = "plan" ]; then
  exit 0
fi

if [ "$MODE" != "deploy" ]; then
  usage
  exit 2
fi

write_env_file "$MODEL" "$ai_root" "$llm_model_dir"
write_runtime_compose_file
ensure_runtime_dirs "$ai_root" "$llm_model_dir"

log "Active runtime settings"
grep -E '^(LOCAL_AI_LLM_PROJECT_NAME|LOCAL_AI_LLM_APP_CONTAINER_NAME|LOCAL_AI_LLM_OLLAMA_CONTAINER_NAME|WEB_BIND_IP|WEB_PORT|GPU_SLOT_COUNT|GPU_SLOT_[0-3]|GPU_DEVICE_IDS|DEFAULT_MODEL|OLLAMA_IMAGE)=' .env || true

log "Rendering Compose configuration"
compose config >/tmp/local-ai-llm-legacy-compose.yml

log "Starting Ollama service"
compose up -d "$OLLAMA_SERVICE"

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

pull_model_if_needed "$MODEL"
ensure_app_image

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

set_default_model "$base_url" "$MODEL"
prewarm_model_if_requested "$base_url" "$MODEL"

log "Container status"
compose ps

log "Visible GPUs inside app container"
compose exec -T "$APP_SERVICE" nvidia-smi --query-gpu=index,uuid,name,memory.total,memory.free --format=csv || true

log "Installed Ollama models"
compose exec -T "$OLLAMA_SERVICE" ollama list || true

log "Running Ollama models"
compose exec -T "$OLLAMA_SERVICE" ollama ps || true

log "Deployment complete"
log "Portal URL: $base_url/"
