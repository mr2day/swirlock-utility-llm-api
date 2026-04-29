import { Module } from '@nestjs/common';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [LlmModule],
})
export class AppModule {}
