# Swirlock LLM Host

Small NestJS model-host server for one local Ollama model.

This service is intentionally agnostic. It does not know whether callers are doing chat, RAG support, memory work, classification, or image understanding. Its job is to expose the model safely, keep it loaded, and serialize access to the local model runner.

It accepts text plus optional image input and returns text only. It does not support image generation.

## Setup

```powershell
npm install
npm run build
npm run start:prod
```

Runtime settings live in one place: `host.config.cjs`.

The configured server binds to the host and port in `host.config.cjs`, so another computer on the
same Wi-Fi can call:

```text
http://<this-computer-lan-ip>:<configured-port>/v2/infer
```

Make sure Windows Firewall allows inbound TCP traffic on the configured port.

## Model Selection

The server hosts exactly one model per running process. Change the hosted model in
`host.config.cjs` by editing `env.OLLAMA_MODEL`.

The model must be present in `env.OLLAMA_MODELS`, the comma-separated allow-list in the same file.
The server refuses to start if `env.OLLAMA_MODEL` is not in that list, so a typo cannot silently
launch the wrong model.

Image input is controlled separately with `env.MODEL_IMAGE_INPUT`. Keep it `true` for
vision-capable models. Set it to `false` for a text-only model.

## Browser Test Page

Open this URL on the host machine:

```text
http://127.0.0.1:<configured-port>/test
```

From another computer on the same Wi-Fi, use:

```text
http://<this-computer-lan-ip>:<configured-port>/test
```

The test page uses the streaming WebSocket endpoint. It has a single composer for text plus
image attachments, removable image thumbnails, a thinking toggle, and live streamed model output.

## Endpoints

- `POST /v2/infer`
- `WS /v2/infer/stream`
- `GET /v2/health`
- `GET /v2/model/status`
- `POST /v2/model/preload`
- `POST /v2/model/unload`

All HTTP requests require:

```text
x-correlation-id: <stable request or turn id>
```

## Inference

Text-only request:

```json
{
  "requestContext": {
    "callerService": "rag-engine",
    "requestedAt": "2026-04-29T12:00:00Z"
  },
  "input": {
    "parts": [
      {
        "type": "text",
        "text": "Summarize this paragraph."
      }
    ]
  },
  "options": {
    "thinking": false,
    "responseFormat": "text",
    "ollama": {
      "temperature": 0.2
    }
  }
}
```

Text plus image request:

```json
{
  "requestContext": {
    "callerService": "context-fragmenter",
    "priority": 10,
    "requestedAt": "2026-04-29T12:00:00Z"
  },
  "input": {
    "parts": [
      {
        "type": "text",
        "text": "Describe only visible facts in this image."
      },
      {
        "type": "image",
        "imageBase64": "<base64 image or data:image/png;base64,...>",
        "mimeType": "image/png"
      }
    ]
  }
}
```

Images can also be supplied with `imageUrl` instead of `imageBase64`.

Response:

```json
{
  "meta": {
    "requestId": "9bd77b0c-a99e-4ed2-a316-9126930ecf57",
    "correlationId": "example-correlation-id",
    "apiVersion": "v2",
    "servedAt": "2026-04-29T12:00:01.000Z"
  },
  "data": {
    "modelId": "configured-model-id",
    "output": {
      "text": "The image shows ..."
    },
    "finishReason": "stop",
    "generatedAt": "2026-04-29T12:00:01.000Z",
    "appliedOptions": {
      "responseFormat": "text",
      "thinking": false,
      "ollama": {
        "temperature": 0.2
      }
    }
  }
}
```

`GET /v2/model/status` reports the active model and the configured model list:

```json
{
  "data": {
    "modelId": "configured-model-id",
    "availableModels": ["configured-model-id"]
  }
}
```

## Streaming Inference

Connect to:

```text
ws://<host>:<configured-port>/v2/infer/stream
```

Send one JSON message per WebSocket connection:

```json
{
  "type": "infer",
  "correlationId": "example-correlation-id",
  "request": {
    "requestContext": {
      "callerService": "browser-test",
      "requestedAt": "2026-04-29T12:00:00Z"
    },
    "input": {
      "parts": [{ "type": "text", "text": "Describe what you see." }]
    },
    "options": {
      "responseFormat": "text",
      "thinking": false,
      "ollama": {
        "temperature": 0.2
      }
    }
  }
}
```

The server streams JSON events:

- `accepted`
- `queued`
- `started`
- `thinking`
- `chunk`
- `done`
- `error`

Open multiple WebSocket connections for multiple callers. The host runs exactly one model request
at a time and queues the rest.

`requestContext.priority` is optional and numeric. Higher numbers run first. If a caller omits
`priority`, the request is treated as lower priority than every request that provides a finite
priority number. Requests with the same priority, including omitted-priority requests, run in
arrival order.

Queued events are only a wait-decision snapshot for the already accepted queued request. They
include:

- `position`: current 1-based position inside the waiting queue
- `requestsAhead`: active request plus queued requests ahead
- `queueDepth`: current total queued requests
- `defaultPriority`: `true` when the caller omitted `requestContext.priority`
- `priority`: the request priority number, only present when the caller provided one
- `averageRequestDurationMs`, when the server has recent request duration samples
- `estimatedWaitMs`, when the server has recent request duration samples
- `estimatedStartAt`, when the server has recent request duration samples

## Host Protection

The host keeps only host-level protections:

- `env.JSON_BODY_LIMIT` from `host.config.cjs`
- one hardcoded active model request at a time
- an in-memory queue for additional requests

The host does not impose text length, image count, image byte, output length, elapsed time, or rate
limits. Callers can pass Ollama generation settings through `options.ollama`.

`env.MODEL_THINKING` controls the default thinking behavior for model calls.

## Keeping The Model Loaded

The app preloads the model on startup with `env.OLLAMA_KEEP_ALIVE`. Every inference request also
sends the same keep-alive value.

This is the best Ollama-native way to keep the model resident in RAM/VRAM during normal use. It cannot be absolute: if another app consumes enough VRAM, the OS, driver, or Ollama may evict or fail to load the model.

For constant service on Windows, build the app and run it under PM2:

```powershell
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

## Notes

- Ollama must be running locally on this machine.
- Runtime settings are defined in `host.config.cjs`.
- This host implements the Swirlock v2 Model Host API.
