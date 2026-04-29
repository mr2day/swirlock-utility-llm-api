# Swirlock LLM Host

NestJS model-host service for one local Ollama model.

This repo implements the Swirlock `v2` Model Host API. It is intentionally an
agnostic model appliance: it owns model availability, inference transport,
health/status, lifecycle commands, and local-machine protection. It must not own
chat orchestration, RAG semantics, memory policy, prompt assembly policy, or
business task interpretation.

## Agent Brief

Read this before changing code:

- This service hosts exactly one configured Ollama model per running process.
- Runtime settings have one source of truth: `host.config.cjs`.
- Do not reintroduce `.env`, `.env.example`, source-code model defaults, or
  duplicate PM2 environment blocks for the same settings.
- `ecosystem.config.cjs` imports `host.config.cjs`; keep that relationship.
- The app runs compiled output from `dist/main.js` in production/PM2.
- The local process manager standard is PM2, not a visible terminal running
  `npm run start:prod`.
- Model hosts are infrastructure. Caller services own task prompts and task
  semantics.

Relevant contract source:

```text
../swirlock-chatbot-contracts/docs/versions/v2/openapi/model-host.openapi.yaml
../swirlock-chatbot-contracts/docs/versions/v2/INTERNAL_INFRASTRUCTURE.md
```

## File Map

- `host.config.cjs`: single source of truth for host, port, model, Ollama URL,
  keep-alive, body limit, and model feature flags.
- `ecosystem.config.cjs`: PM2 app definition; imports `host.config.cjs`.
- `src/env.ts`: loads `host.config.cjs` into `process.env` at app startup.
- `src/main.ts`: Nest bootstrap, CORS, body limits, static `/test`, WebSocket
  attachment, host/port binding.
- `src/llm/llm.controller.ts`: HTTP API routes and status codes.
- `src/llm/llm.websocket.ts`: `WS /v2/infer/stream`.
- `src/llm/llm.service.ts`: Ollama calls, request validation, model lifecycle,
  health/status, queueing, and streaming.
- `src/llm/types.ts`: local TypeScript shape of the Model Host API.
- `public/test/index.html`: browser test client for streaming inference.

## Runtime Configuration

Change runtime settings only in `host.config.cjs`.

Important values:

- `env.PORT`
- `env.HOST`
- `env.OLLAMA_HOST`
- `env.OLLAMA_MODELS`
- `env.OLLAMA_MODEL`
- `env.OLLAMA_KEEP_ALIVE`
- `env.PRELOAD_MODEL`
- `env.MODEL_IMAGE_INPUT`
- `env.MODEL_THINKING`
- `env.JSON_BODY_LIMIT`

`env.OLLAMA_MODEL` must be present in `env.OLLAMA_MODELS`. Startup fails if
required config is missing or internally inconsistent.

## Local Operation

Install and build:

```powershell
npm install -g pm2
npm install
npm run build
```

Run under PM2:

```powershell
pm2 start ecosystem.config.cjs
pm2 status
pm2 save
```

Check logs:

```powershell
pm2 logs swirlock-llm-host
```

Restart after code or config changes:

```powershell
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```

Stop the service:

```powershell
pm2 stop swirlock-llm-host
```

PM2 restores saved processes with:

```powershell
pm2 resurrect
```

On this Windows machine, startup after user logon is handled by a Startup-folder
script that runs `pm2 resurrect`. For pre-login boot startup, use an elevated
Windows service or scheduled task.

## Verification

Typecheck and build:

```powershell
npm run typecheck
npm run build
```

Health/status check:

```powershell
Invoke-WebRequest `
  -UseBasicParsing `
  -Headers @{ 'x-correlation-id' = 'local-check' } `
  http://127.0.0.1:<configured-port>/v2/model/status
```

Browser test page:

```text
http://127.0.0.1:<configured-port>/test
```

From another LAN machine:

```text
http://<host-lan-ip>:<configured-port>/test
```

Make sure Windows Firewall allows inbound TCP traffic on the configured port for
the intended LAN profile.

## API Surface

HTTP:

- `POST /v2/infer` returns `200`
- `GET /v2/health` returns `200`
- `GET /v2/model/status` returns `200`
- `POST /v2/model/preload` returns `202`
- `POST /v2/model/unload` returns `202`

WebSocket:

- `WS /v2/infer/stream`

All HTTP requests require:

```text
x-correlation-id: <stable request or turn id>
```

The WebSocket stream accepts one JSON message per connection:

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

Stream event types:

- `accepted`
- `queued`
- `started`
- `thinking`
- `chunk`
- `done`
- `error`

## Request Shape

Text-only request:

```json
{
  "requestContext": {
    "callerService": "rag-engine",
    "requestedAt": "2026-04-29T12:00:00Z"
  },
  "input": {
    "parts": [{ "type": "text", "text": "Summarize this paragraph." }]
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
      { "type": "text", "text": "Describe only visible facts in this image." },
      {
        "type": "image",
        "imageBase64": "<base64 image or data:image/png;base64,...>",
        "mimeType": "image/png"
      }
    ]
  }
}
```

Images may use `imageBase64` or `imageUrl`. Exactly one of those fields is
required for each image part. `imageUrl` must be HTTP or HTTPS and must return an
image content type.

## Queueing And Capacity

The host exposes one hardcoded model slot. If a request is already active,
additional requests queue in memory.

Queue order:

1. Higher numeric `requestContext.priority` first.
2. Earlier arrival first when priorities are equal.
3. Omitted priority is lower than every finite numeric priority.

Streaming queued events may include:

- `position`
- `requestsAhead`
- `queueDepth`
- `defaultPriority`
- `priority`
- `averageRequestDurationMs`
- `estimatedWaitMs`
- `estimatedStartAt`

## Model Lifecycle

When `env.PRELOAD_MODEL` is true, the app preloads the configured model during
Nest module initialization using `env.OLLAMA_KEEP_ALIVE`.

Every inference request also sends the same keep-alive value to Ollama.

Lifecycle commands:

- `POST /v2/model/preload`: load or refresh keep-alive for the configured model.
- `POST /v2/model/unload`: ask Ollama to unload the configured model with
  `keep_alive: 0`.

## Boundaries And Non-Goals

This service does not:

- create final chatbot answers as a product concern
- decide whether retrieval or memory is needed
- perform RAG
- perform memory extraction or consolidation
- store images durably
- generate images
- impose task-level token, elapsed-time, image-count, or rate limits

Caller services own task-level limits and may pass Ollama runtime settings
through `options.ollama`.

## Notes

- Ollama must be running locally at `env.OLLAMA_HOST`.
- This service is designed for trusted LAN use inside the Swirlock ecosystem.
- External/public interactions should go through the appropriate Swirlock
  domain services, not directly to this model host.
