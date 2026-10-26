import { Module } from '@nestjs/common';
import { HealthController } from './common/health/health.controller.js';

// Los módulos de dominio (src/modules/*) se registran aquí según llegan sus features.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
