import 'reflect-metadata';
import './env';
import { join } from 'node:path';
import { static as serveStatic } from 'express';
import type { Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LlmService } from './llm/llm.service';
import { MODEL_WS_PATH } from './config';
import { attachLlmWebSocketServer } from './llm/llm.websocket';
import { getRequiredStringEnv } from './llm/runtime';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use('/test/config.js', (_req: Request, res: Response) => {
    res.type('application/javascript').send(
      `window.SWIRLOCK_WS_PATH = ${JSON.stringify(MODEL_WS_PATH)};\n`,
    );
  });
  app.use('/test', serveStatic(join(process.cwd(), 'public', 'test'), { index: 'index.html' }));

  attachLlmWebSocketServer(app.getHttpServer(), app.get(LlmService));

  const port = parsePort(getRequiredStringEnv('PORT'));
  const host = getRequiredStringEnv('HOST');

  await app.listen(port, host);
  console.log(`Swirlock LLM Host listening for WS on ws://${host}:${port}${MODEL_WS_PATH}`);
  console.log(`Test UI available at http://${host}:${port}/test/`);
}

void bootstrap();

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535 in host.config.cjs.');
  }

  return port;
}
