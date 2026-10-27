import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Límite de peticiones en memoria (D17): por defecto 10 por IP y por endpoint cada 60 s (R39).
 * El ThrottlerGuard NO es global: solo lo llevan los endpoints con @PublicThrottled().
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [
        { ttl: config.throttleTtlMs, limit: config.throttleLimit },
      ],
    }),
  ],
  exports: [ThrottlerModule],
})
export class ThrottleModule {}
