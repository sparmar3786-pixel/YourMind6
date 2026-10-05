# Qwen Financial Model Server

This service runs the Qwen3-8B Financial Numerical Reasoning GGUF model with `llama-server` and exposes an OpenAI-compatible `/v1/chat/completions` API.

## Railway

Create a separate Railway service from this repository and set its Root Directory to `/qwen-server`. Railway can deploy isolated services from a monorepo by setting a service root directory. The included Dockerfile is detected automatically.

Attach a persistent Railway Volume mounted at `/models`. The Q4_K_M model is about 5 GB, so use a volume larger than 5 GB (10 GB+ is recommended). The first deployment downloads the model from Hugging Face into the persistent cache; later restarts reuse the cache.

Required variables:

- `QWEN_API_KEY` — a strong random secret used by clients as `Authorization: Bearer ...`

Optional variables:

- `QWEN_MODEL_REPO` — defaults to `mradermacher/Qwen3-8B-Financial-Numerical-Reasoning-GGUF`
- `QWEN_MODEL_FILE` — defaults to `Qwen3-8B-Financial-Numerical-Reasoning.Q4_K_M.gguf`
- `QWEN_CTX_SIZE` — defaults to `8192`
- `QWEN_THREADS` — defaults to `4`
- `QWEN_PARALLEL` — defaults to `1`

## F16 mode

To serve the F16 model instead, change `QWEN_MODEL_FILE` to:

`Qwen3-8B-Financial-Numerical-Reasoning.f16.gguf`

Use a substantially larger Railway volume and enough RAM for the F16 model. Do not run Q4 and F16 in the same service at the same time.

## API test

`GET /health` is available for a Railway health check.

Chat endpoint:

`POST /v1/chat/completions`

Example request body:

```json
{
  "messages": [
    {"role": "system", "content": "You are a financial numerical reasoning assistant. Do not claim certainty about future prices."},
    {"role": "user", "content": "Analyze this numerical trading scenario: NIFTY entry 25000, stop 24900, target 25200."}
  ],
  "temperature": 0.2,
  "max_tokens": 512
}
```

The server is intended to be called by the existing backend, not directly from the APK. Keep the Qwen API key in Railway variables rather than shipping it inside the Android app.
