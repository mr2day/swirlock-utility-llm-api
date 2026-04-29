import 'reflect-metadata';
import './env';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const jsonLimit = process.env.JSON_BODY_LIMIT ?? '50mb';

  app.enableCors({ origin: true });
  app.use(json({ limit: jsonLimit }));
  app.use(urlencoded({ extended: true, limit: jsonLimit }));

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);
  console.log(`Utility LLM API listening on http://${host}:${port}`);
}

void bootstrap();
