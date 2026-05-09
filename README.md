# Swirlock LLM Host

Generic Model Host implementation for Swirlock. The ecosystem API is
WebSocket-only. This host implements the **v5 Model Host contract**
(`docs/versions/v5/apps/model-host.md` in `swirlock-chatbot-contracts`)
and continues to serve the v4 endpoint path during the migration window
so existing v4 callers (RAG Engine, the un-refactored Chat Orchestrator)
keep working unchanged. The v4 and v5 endpoints are wire-compatible —
only the URL path differs.

## Endpoints

```text
WS /v5/model    (current contract; preferred for new callers)
WS /v4/model    (legacy; identical wire format; supported during migration)
```

Client message types:

- `infer`
- `health.get`
- `model.status`
- `model.preload`
- `model.unload`
- `cancel`
- `heartbeat`

Server message types:

- `accepted`
- `queued`
- `started`
- `thinking`
- `chunk`
- `done`
- `health`
- `model.status`
- `model.preload`
- `model.unload`
- `error`
- `heartbeat`

Each message is the shared v4 envelope:

```json
{
  "type": "infer",
  "correlationId": "example-correlation-id",
  "payload": {
    "request": {
      "requestContext": {
        "callerService": "chat-orchestrator",
        "requestedAt": "2026-05-06T12:00:00Z",
        "priority": 100
      },
      "input": {
        "parts": [{ "type": "text", "text": "Hello" }]
      },
      "options": {
        "responseFormat": "text",
        "thinking": false
      }
    }
  }
}
```

There are no ecosystem REST endpoints.

## Run

```powershell
npm install
npm run build
npm run start
```

Configuration lives in `host.config.cjs`.
