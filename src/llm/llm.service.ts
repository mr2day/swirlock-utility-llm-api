import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Ollama, type Message, type Options } from 'ollama';
import { getBooleanEnv, getNumberEnv, getStringEnv, parseKeepAlive } from './runtime';
import type { GenerateBody, GenerateResponse, RequestMessage } from './types';

const DEFAULT_MODEL = 'qwen3.5:9b';
const DEFAULT_PROMPT_FOR_IMAGES = 'Analyze the attached image(s).';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly model = getStringEnv('OLLAMA_MODEL', DEFAULT_MODEL);
  private readonly keepAlive = parseKeepAlive(getStringEnv('OLLAMA_KEEP_ALIVE', '-1'));
  private readonly preloadModel = getBooleanEnv('PRELOAD_MODEL', true);
  private readonly maxImageBytes = getNumberEnv('MAX_IMAGE_BYTES', 20 * 1024 * 1024);
  private readonly ollama = new Ollama({
    host: getStringEnv('OLLAMA_HOST', 'http://127.0.0.1:11434'),
  });

  async onModuleInit(): Promise<void> {
    if (!this.preloadModel) {
      return;
    }

    try {
      await this.ollama.chat({
        model: this.model,
        messages: [],
        stream: false,
        keep_alive: this.keepAlive,
      });
      this.logger.log(`Preloaded ${this.model} with keep_alive=${String(this.keepAlive)}`);
    } catch (error) {
      this.logger.warn(
        `Could not preload ${this.model}. The API will still start, but requests will fail until Ollama can load the model. ${getErrorMessage(error)}`,
      );
    }
  }

  async generate(body: GenerateBody, files: Express.Multer.File[] = []): Promise<GenerateResponse> {
    const uploadedImages = this.normalizeUploadedImages(files);
    const bodyImages = this.normalizeImageList(body.images, 'images');
    const messages = this.buildMessages(body, [...bodyImages, ...uploadedImages]);
    const options = this.normalizeOptions(body.options);
    const think = this.normalizeThink(body.think);

    try {
      const response = await this.ollama.chat({
        model: this.model,
        messages,
        stream: false,
        keep_alive: this.keepAlive,
        ...(options ? { options } : {}),
        ...(think !== undefined ? { think } : {}),
      });

      return {
        text: response.message?.content ?? '',
        model: response.model,
        doneReason: response.done_reason,
        stats: {
          totalDurationNs: response.total_duration,
          loadDurationNs: response.load_duration,
          promptEvalCount: response.prompt_eval_count,
          evalCount: response.eval_count,
        },
      };
    } catch (error) {
      throw new BadGatewayException({
        message: 'Ollama request failed',
        detail: getErrorMessage(error),
        model: this.model,
      });
    }
  }

  private buildMessages(body: GenerateBody, requestImages: string[]): Message[] {
    const prompt = this.getPrompt(body);
    const system = this.getOptionalString(body.system, 'system');
    const suppliedMessages = this.normalizeMessages(body.messages);
    const messages: Message[] = [];

    if (system && !suppliedMessages.some((message) => message.role === 'system')) {
      messages.push({ role: 'system', content: system });
    }

    messages.push(...suppliedMessages);

    if (prompt || requestImages.length > 0) {
      messages.push({
        role: 'user',
        content: prompt || DEFAULT_PROMPT_FOR_IMAGES,
        ...(requestImages.length > 0 ? { images: requestImages } : {}),
      });
    }

    if (messages.length === 0) {
      throw new BadRequestException('Provide text, images, or messages.');
    }

    const hasUserInput = messages.some(
      (message) =>
        message.role === 'user' && (message.content.trim().length > 0 || message.images?.length),
    );

    if (!hasUserInput) {
      throw new BadRequestException('Provide at least one user message, text prompt, or image.');
    }

    return messages;
  }

  private normalizeMessages(value: unknown): Message[] {
    if (value === undefined || value === null || value === '') {
      return [];
    }

    const rawMessages = this.parseMaybeJson(value, 'messages');

    if (!Array.isArray(rawMessages)) {
      throw new BadRequestException('messages must be an array.');
    }

    return rawMessages.map((message, index) => {
      if (!this.isRecord(message)) {
        throw new BadRequestException(`messages[${index}] must be an object.`);
      }

      const role = this.getOptionalString(message.role, `messages[${index}].role`) ?? 'user';
      const content = this.getOptionalString(message.content, `messages[${index}].content`) ?? '';
      const images = this.normalizeImageList(message.images, `messages[${index}].images`);

      if (!['system', 'user', 'assistant'].includes(role)) {
        throw new BadRequestException(
          `messages[${index}].role must be one of system, user, or assistant.`,
        );
      }

      return {
        role,
        content,
        ...(images.length > 0 ? { images } : {}),
      };
    });
  }

  private normalizeUploadedImages(files: Express.Multer.File[]): string[] {
    return files.map((file, index) => {
      if (!file.mimetype?.startsWith('image/')) {
        throw new BadRequestException(`Uploaded file ${index + 1} must be an image.`);
      }

      if (file.size > this.maxImageBytes) {
        throw new BadRequestException(`Uploaded file ${index + 1} exceeds MAX_IMAGE_BYTES.`);
      }

      return file.buffer.toString('base64');
    });
  }

  private normalizeImageList(value: unknown, fieldName: string): string[] {
    if (value === undefined || value === null || value === '') {
      return [];
    }

    const parsed = this.parseMaybeJson(value, fieldName);
    const rawImages = Array.isArray(parsed) ? parsed : [parsed];

    return rawImages.map((image, index) => {
      if (typeof image !== 'string') {
        throw new BadRequestException(`${fieldName}[${index}] must be a base64 string.`);
      }

      const normalized = stripDataUrlPrefix(image).replace(/\s+/g, '');
      if (!normalized) {
        throw new BadRequestException(`${fieldName}[${index}] is empty.`);
      }

      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw new BadRequestException(`${fieldName}[${index}] is not valid base64.`);
      }

      return normalized;
    });
  }

  private normalizeOptions(value: unknown): Partial<Options> | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const parsed = this.parseMaybeJson(value, 'options');

    if (!this.isRecord(parsed)) {
      throw new BadRequestException('options must be an object.');
    }

    return parsed as Partial<Options>;
  }

  private normalizeThink(value: unknown): boolean | 'high' | 'medium' | 'low' | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase().trim();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
      if (['high', 'medium', 'low'].includes(normalized)) {
        return normalized as 'high' | 'medium' | 'low';
      }
    }

    throw new BadRequestException('think must be true, false, high, medium, or low.');
  }

  private getPrompt(body: GenerateBody): string {
    const prompt = this.getOptionalString(body.prompt, 'prompt');
    const text = this.getOptionalString(body.text, 'text');
    return (prompt ?? text ?? '').trim();
  }

  private getOptionalString(value: unknown, fieldName: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a string.`);
    }

    return value;
  }

  private parseMaybeJson(value: unknown, fieldName: string): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        throw new BadRequestException(`${fieldName} contains invalid JSON.`);
      }
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

function stripDataUrlPrefix(value: string): string {
  const trimmed = value.trim();
  const dataUrlMatch = /^data:image\/[-+.a-zA-Z0-9]+;base64,(?<data>.*)$/s.exec(trimmed);
  return dataUrlMatch?.groups?.data ?? trimmed;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
