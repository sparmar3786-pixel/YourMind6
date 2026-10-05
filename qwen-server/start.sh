#!/bin/sh
set -eu

: "${PORT:=8080}"
: "${QWEN_MODEL_REPO:=mradermacher/Qwen3-8B-Financial-Numerical-Reasoning-GGUF}"
: "${QWEN_MODEL_FILE:=Qwen3-8B-Financial-Numerical-Reasoning.Q4_K_M.gguf}"
: "${QWEN_API_KEY:=}"
: "${QWEN_CTX_SIZE:=8192}"
: "${QWEN_THREADS:=4}"
: "${QWEN_PARALLEL:=1}"

mkdir -p /models/cache

set -- \
  --host 0.0.0.0 \
  --port "$PORT" \
  --hf-repo "$QWEN_MODEL_REPO" \
  --hf-file "$QWEN_MODEL_FILE" \
  --ctx-size "$QWEN_CTX_SIZE" \
  --threads "$QWEN_THREADS" \
  --parallel "$QWEN_PARALLEL" \
  --no-webui

if [ -n "$QWEN_API_KEY" ]; then
  umask 077
  printf '%s\n' "$QWEN_API_KEY" > /tmp/qwen-api-key
  set -- "$@" --api-key-file /tmp/qwen-api-key
fi

exec /app/llama-server "$@"
