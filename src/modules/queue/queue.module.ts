import { Module } from '@nestjs/common';
import { EncountersModule } from '../encounters/encounters.module.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';

/** Cola priorizada (F-06-api). Sin tablas propias: lee con EncountersService (el nivel final vive en encounters). */
@Module({
  imports: [EncountersModule],
  controllers: [QueueController],
  providers: [QueueService],
})
export class QueueModule {}
