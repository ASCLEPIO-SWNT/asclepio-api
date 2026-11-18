import { ApiProperty } from '@nestjs/swagger';
import {
  ESTIMATE_BASES,
  type EstimateBasis,
  QUEUE_PHASES,
  type QueuePhase,
} from '../estimate.rules.js';

/** GET /patient/queue-position(/stream): sin parámetros; cualquiera → 400 por forbidNonWhitelisted (R13). */
export class PatientQueueQueryDto {}

/** Rango de espera estimado (PA-F10-1, valores provisionales). */
export class WaitEstimateDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Límite inferior: 0,5 × eta, redondeado hacia abajo a 5 min.',
  })
  minMinutes: number;
  @ApiProperty({
    type: 'integer',
    minimum: 5,
    description:
      'Límite superior: 1,5 × eta, redondeado hacia arriba a 5 min, nunca menos de 5.',
  })
  maxMinutes: number;
}

/**
 * Instantánea de la posición del paciente (F-10-api). Nunca lleva ids de atención, sede o paciente, ningún nivel de
 * triage (tampoco el propio) ni datos de otros pacientes (R6).
 */
export class QueuePositionDto {
  @ApiProperty({
    enum: QUEUE_PHASES,
    description:
      'NO_ACTIVE: sin atención activa (p. ej. pre-registro pendiente de recepción). WAITING_TRIAGE: espera de triage. WAITING_CARE: clasificado, espera de atención médica. CALLED: en atención. DONE: la atención terminó (solo en el stream, que se cierra a continuación).',
  })
  phase: QueuePhase;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    nullable: true,
    description:
      'Posición (desde 1) dentro de la fase, con el mismo orden de la cola del personal (F-06) limitado a la sede de la atención. null en CALLED, DONE y NO_ACTIVE.',
  })
  position: number | null;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    nullable: true,
    description:
      'Personas delante (position − 1); null cuando position es null.',
  })
  aheadCount: number | null;
  @ApiProperty({
    type: WaitEstimateDto,
    nullable: true,
    description:
      'Rango de espera por el ritmo reciente de la fase en la sede (salidas en las últimas 4 h): eta = aheadCount × 240 / salidas. null con menos de 5 salidas (INSUFFICIENT_DATA) o sin posición.',
  })
  estimate: WaitEstimateDto | null;
  @ApiProperty({
    enum: ESTIMATE_BASES,
    nullable: true,
    description:
      'RECENT_THROUGHPUT si hay estimación; INSUFFICIENT_DATA con menos de 5 salidas de la fase en la ventana; null sin posición.',
  })
  estimateBasis: EstimateBasis | null;
  @ApiProperty({
    format: 'date-time',
    description: 'Hora del servidor con la que se calculó la instantánea.',
  })
  serverNow: string;
}
