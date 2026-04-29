# Utility LLM API

Small NestJS server that exposes one Ollama-backed endpoint for `qwen3.5:9b`.
It accepts text plus optional image inputs and returns text only.

## Setup

```powershell
npm install
copy .env.example .env
npm run build
npm run start:prod
```

The default server binds to `0.0.0.0:3000`, so another computer on the same Wi-Fi can call:

```text
http://<this-computer-lan-ip>:3000/api/generate
```

Make sure Windows Firewall allows inbound TCP traffic on port `3000`.

## API

`POST /api/generate`

JSON text-only request:

```json
{
  "prompt": "Write a short summary of what utility APIs are useful for."
}
```

JSON text-plus-image request:

```json
{
  "prompt": "What is visible in this image?",
  "images": ["<base64 image or data:image/png;base64,...>"]
}
```

Multipart request:

```powershell
curl.exe -X POST http://localhost:3000/api/generate `
  -F "prompt=What is in this picture?" `
  -F "images=@C:\path\to\picture.png"
```

Response:

```json
{
  "text": "The image shows ...",
  "model": "qwen3.5:9b",
  "doneReason": "stop",
  "stats": {
    "totalDurationNs": 123,
    "loadDurationNs": 0,
    "promptEvalCount": 10,
    "evalCount": 20
  }
}
```

## Keeping The Model Loaded

The app preloads the model on startup by calling Ollama chat with no messages and
`keep_alive=-1`. Every request also sends the same `keep_alive` value. This is the
best Ollama-native way to keep the model resident in RAM/VRAM during normal use.

It cannot be made absolute: if another app consumes enough VRAM, the OS/driver or
Ollama may have to evict or fail to load the model. In that case, stop this API
before gaming or other GPU-heavy work, then start it again afterward.

For constant service on Windows, build the app and run it under PM2:

```powershell
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

## Notes

- Ollama must be running locally on this machine.
- `qwen3.5:9b` is configured by default and can be changed with `OLLAMA_MODEL`.
- This API intentionally does not support image generation and never returns images.
