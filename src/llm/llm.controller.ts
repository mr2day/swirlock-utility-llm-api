import { Body, Controller, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LlmService } from './llm.service';
import { getNumberEnv } from './runtime';
import type { GenerateBody, GenerateResponse } from './types';

@Controller('api')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Post('generate')
  @UseInterceptors(
    FilesInterceptor('images', getNumberEnv('MAX_IMAGE_FILES', 8), {
      storage: memoryStorage(),
      limits: {
        fileSize: getNumberEnv('MAX_IMAGE_BYTES', 20 * 1024 * 1024),
        files: getNumberEnv('MAX_IMAGE_FILES', 8),
      },
    }),
  )
  async generate(
    @Body() body: GenerateBody,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ): Promise<GenerateResponse> {
    return this.llmService.generate(body, files);
  }
}
