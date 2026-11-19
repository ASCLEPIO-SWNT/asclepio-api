import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/decorators.js';
import { ApiThrottledResponse } from './throttled.decorator.js';

/**
 * Límite por paciente (no por IP) con el mismo ThrottlerGuard en memoria: el contador va por el patientId del token
 * (el guard global de autenticación corre antes y deja el principal en la petición) y por endpoint. 429 problem+json
 * con Retry-After. Lo usa POST /patient/symptom-interview/next-question (F-11-api, R16, PA-F11-5).
 */
export const PatientThrottled = (limit: number, ttlMs: number) =>
  applyDecorators(
    UseGuards(ThrottlerGuard),
    Throttle({
      default: {
        limit,
        ttl: ttlMs,
        getTracker: (req: Record<string, unknown>) => {
          const p = (req as AuthenticatedRequest).principal;
          return p?.kind === 'PATIENT'
            ? `patient:${p.patientId}`
            : `ip:${typeof req.ip === 'string' ? req.ip : ''}`;
        },
      },
    }),
    ApiThrottledResponse(
      `Demasiadas peticiones de este paciente a este endpoint (más de ${limit} cada ${ttlMs / 60_000} min; application/problem+json).`,
    ),
  );
