import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';
import {
  ENCOUNTER_STATUSES,
  type EncounterStatus,
} from '../../encounters/encounter-state-machine.js';
import type { QueueSex } from '../queue.rules.js';

/** GET /queue: solo siteId (UUID). Cualquier otro parámetro → 400 por forbidNonWhitelisted (R6). */
export class QueueQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Limita la cola a una sede del tenant (PA-F06-4). Una sede inexistente o de otra IPS devuelve las secciones vacías.',
  })
  @ValidateIf((o: QueueQueryDto) => o.siteId !== undefined)
  @IsUUID('all')
  siteId?: string;
}

/** Datos del paciente en la cola (PA-F06-5, R7): sin nombre completo, documento, fecha de nacimiento ni id. */
export class QueuePatientDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Primera letra (mayúscula, sin tilde) de la primera y de la última palabra del nombre; null si es NN.',
  })
  initials: string | null;
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Años cumplidos en America/Bogota a serverNow (o la edad estimada si no hay fecha de nacimiento).',
  })
  ageYears: number | null;
  @ApiProperty({ type: String, enum: ['M', 'F', 'X'], nullable: true })
  sex: QueueSex | null;
}

export class QueueItemDto {
  @ApiProperty({ format: 'uuid' }) encounterId: string;
  @ApiProperty({ format: 'uuid' }) siteId: string;
  @ApiProperty() siteName: string;
  @ApiProperty({
    enum: ENCOUNTER_STATUSES.filter((s) =>
      ['WAITING_TRIAGE', 'TRIAGED', 'IN_CARE'].includes(s),
    ),
  })
  status: EncounterStatus;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 5,
    nullable: true,
    description: 'Nivel final de triage; null en waitingTriage.',
  })
  finalLevel: number | null;
  @ApiProperty({
    format: 'date-time',
    description: 'Hora legal de llegada (servidor).',
  })
  arrivalAt: string;
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Espera desde la llegada: minutos enteros completos desde arrivalAt hasta serverNow (PA-F06-2); null en inCare (la espera terminó). Solo se muestra y ordena waitingTriage: no decide la alerta ni el orden de triaged.',
  })
  waitMinutes: number | null;
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Minutos enteros completos desde la clasificación (triagedAt) hasta serverNow, en triaged; null en waitingTriage y en inCare (Res. 256 de 2016, DT-02). Ordena triaged dentro de cada nivel.',
  })
  minutesSinceTriage: number | null;
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Tiempo máximo del nivel, contado desde la clasificación (Res. 256 de 2016), con los valores de la Res. 5596 de 2015: I = 0, II = 30; null sin nivel o en III–V.',
  })
  maxWaitMinutes: number | null;
  @ApiProperty({
    description:
      'true solo en triaged cuando el tiempo exacto desde la clasificación (serverNow − triagedAt, en milisegundos) supera maxWaitMinutes (Res. 256 de 2016): nivel I con cualquier tiempo > 0, nivel II con más de 30 min. Como minutesSinceTriage se muestra en minutos completos, puede ser true con minutesSinceTriage igual al máximo (p. ej. 30 min y 1 s). Nunca en III–V, waitingTriage ni inCare.',
  })
  overdue: boolean;
  @ApiProperty({ type: QueuePatientDto }) patient: QueuePatientDto;
}

export class QueueDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'Hora del servidor con la que se calcularon todas las esperas, los minutos desde la clasificación y las alertas de la respuesta.',
  })
  serverNow: string;
  @ApiProperty({
    type: [QueueItemDto],
    description:
      'WAITING_TRIAGE, mayor espera desde la llegada (waitMinutes) primero.',
  })
  waitingTriage: QueueItemDto[];
  @ApiProperty({
    type: [QueueItemDto],
    description:
      'TRIAGED, nivel ascendente y, en cada nivel, más tiempo desde la clasificación primero (mayor minutesSinceTriage; Res. 256 de 2016), con los empates por id. Las que no tienen triagedAt, al final.',
  })
  triaged: QueueItemDto[];
  @ApiProperty({
    type: [QueueItemDto],
    description: 'IN_CARE, nivel ascendente y después llegada ascendente.',
  })
  inCare: QueueItemDto[];
}
