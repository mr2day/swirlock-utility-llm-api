import { HttpException, HttpStatus } from '@nestjs/common';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ApiErrorBody } from './api-error';
import { createApiMeta } from './response-meta';
import { LlmService, type StreamEvent } from './llm.service';
import type { InferRequest } from './types';

interface StreamRequestMessage {
  type: 'infer';
  correlationId: string;
  request: InferRequest;
}

interface StreamCancelMessage {
  type: 'cancel';
  correlationId: string;
}

type StreamClientMessage = StreamRequestMessage | StreamCancelMessage;

type StreamSocketEvent =
  | StreamEvent
  | {
      type: 'error';
      meta: ReturnType<typeof createApiMeta>;
      error: ApiErrorBody;
    };

type CorrelatedStreamSocketEvent = StreamSocketEvent & { correlationId: string };

export function attachLlmWebSocketServer(server: Server, llmService: LlmService): WebSocketServer {
  const webSocketServer = new WebSocketServer({
    server,
    path: '/v2/infer/stream',
  });

  webSocketServer.on('connection', (socket) => {
    const activeRequests = new Map<string, AbortController>();

    socket.on('close', () => {
      for (const controller of activeRequests.values()) {
        controller.abort();
      }
      activeRequests.clear();
    });

    socket.on('error', () => {
      for (const controller of activeRequests.values()) {
        controller.abort();
      }
      activeRequests.clear();
    });

    socket.on('message', (data) => {
      void handleStreamMessage(socket, data, llmService, activeRequests);
    });
  });

  return webSocketServer;
}

async function handleStreamMessage(
  socket: WebSocket,
  data: RawData,
  llmService: LlmService,
  activeRequests: Map<string, AbortController>,
): Promise<void> {
  let correlationId = 'missing-correlation-id';

  try {
    const message = parseStreamMessage(data);
    correlationId = message.correlationId;

    if (message.type === 'cancel') {
      const active = activeRequests.get(correlationId);
      active?.abort();
      activeRequests.delete(correlationId);
      return;
    }

    if (activeRequests.has(correlationId)) {
      sendSocketEvent(socket, {
        type: 'error',
        correlationId,
        meta: createApiMeta(correlationId),
        error: validationError(`Inference request ${correlationId} is already active.`),
      });
      return;
    }

    const abortController = new AbortController();
    activeRequests.set(correlationId, abortController);

    await llmService.streamInfer(
      correlationId,
      message.request,
      (event) => sendSocketEvent(socket, withCorrelationId(event, correlationId)),
      abortController.signal,
    );
  } catch (error) {
    sendSocketEvent(socket, {
      type: 'error',
      correlationId,
      meta: createApiMeta(correlationId),
      error: normalizeError(error),
    });
  } finally {
    activeRequests.delete(correlationId);
  }
}

function parseStreamMessage(data: RawData): StreamClientMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw new HttpException(
      {
        error: validationError('WebSocket message must be valid JSON.'),
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  if (!isRecord(parsed)) {
    throw new HttpException(
      {
        error: validationError('WebSocket message must be an object.'),
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  if (parsed.type !== 'infer' && parsed.type !== 'cancel') {
    throw new HttpException(
      {
        error: validationError('WebSocket message type must be infer or cancel.'),
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  if (typeof parsed.correlationId !== 'string' || !parsed.correlationId.trim()) {
    throw new HttpException(
      {
        error: validationError('correlationId is required.'),
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  if (parsed.type === 'cancel') {
    return {
      type: 'cancel',
      correlationId: parsed.correlationId.trim(),
    };
  }

  if (!isRecord(parsed.request)) {
    throw new HttpException(
      {
        error: validationError('request is required.'),
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  return {
    type: 'infer',
    correlationId: parsed.correlationId.trim(),
    request: parsed.request as unknown as InferRequest,
  };
}

function sendSocketEvent(socket: WebSocket, event: CorrelatedStreamSocketEvent): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(event));
}

function withCorrelationId(event: StreamEvent, correlationId: string): CorrelatedStreamSocketEvent {
  return { ...event, correlationId };
}

function normalizeError(error: unknown): ApiErrorBody {
  if (error instanceof HttpException) {
    const response = error.getResponse();

    if (isRecord(response) && isRecord(response.error)) {
      return normalizeApiErrorBody(response.error, error.getStatus());
    }

    return {
      code: fallbackCode(error.getStatus()),
      message: error.message || fallbackMessage(error.getStatus()),
      retryable: error.getStatus() >= 500,
    };
  }

  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'WebSocket inference failed.',
    retryable: true,
  };
}

function normalizeApiErrorBody(error: Record<string, unknown>, status: number): ApiErrorBody {
  return {
    code:
      typeof error.code === 'string' ? (error.code as ApiErrorBody['code']) : fallbackCode(status),
    message: typeof error.message === 'string' ? error.message : fallbackMessage(status),
    retryable: typeof error.retryable === 'boolean' ? error.retryable : status >= 500,
    details: isRecord(error.details) ? error.details : undefined,
  };
}

function validationError(message: string): ApiErrorBody {
  return {
    code: 'validation_failed',
    message,
    retryable: false,
  };
}

function fallbackCode(status: number): ApiErrorBody['code'] {
  if (status === HttpStatus.BAD_REQUEST) {
    return 'bad_request';
  }
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
    return 'limit_exceeded';
  }
  if (status >= 500) {
    return 'internal_error';
  }
  return 'validation_failed';
}

function fallbackMessage(status: number): string {
  return status >= 500 ? 'Internal server error' : 'Request failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
