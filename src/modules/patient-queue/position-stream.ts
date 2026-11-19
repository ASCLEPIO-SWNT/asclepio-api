import type { MessageEvent } from '@nestjs/common';
import {
  debounceTime,
  defer,
  EMPTY,
  from,
  interval,
  map,
  merge,
  type Observable,
  type ObservableInput,
  of,
  type SchedulerLike,
  switchMap,
  takeUntil,
  takeWhile,
  timer,
} from 'rxjs';
import type { QueuePositionDto } from './dto/patient-queue.dto.js';

/** Tiempos del stream (D3, ADR 0009): agrupa ráfagas de cambios 1 s (R8: ≤ 2 s) y recalcula cada 15 s (R9). */
export interface StreamTiming {
  debounceMs: number;
  heartbeatMs: number;
}
export const STREAM_TIMING: StreamTiming = Object.freeze({
  debounceMs: 1000,
  heartbeatMs: 15_000,
});
/** Token de inyección de los tiempos (las pruebas e2e los acortan). */
export const PATIENT_QUEUE_TIMING = Symbol('PATIENT_QUEUE_TIMING');

/** Nombre del evento SSE de la instantánea y texto del comentario de latido. */
export const POSITION_EVENT = 'position';
export const HEARTBEAT_COMMENT = 'ping';

/** Instantánea sin serverNow: dos instantáneas son iguales si solo cambia la hora (D3). */
function keyOf(s: QueuePositionDto): string {
  const { serverNow: _ignored, ...rest } = s;
  void _ignored;
  return JSON.stringify(rest);
}

/**
 * Stream de la posición (D3), puro sobre rxjs: merge(inicio, cambios con debounce, intervalo) → switchMap(compute) →
 * evento `position` solo si la instantánea cambió; si no cambió y el disparo fue el intervalo, un comentario de
 * latido. Termina tras emitir DONE (R10) o a los `closeAfterMs` (vencimiento del token, R11).
 */
export function positionStream(opts: {
  compute: () => ObservableInput<QueuePositionDto>;
  /** Cambios que afectan al paciente (ya filtrados por su sede). */
  changes$: Observable<unknown>;
  closeAfterMs: number;
  timing: StreamTiming;
  scheduler?: SchedulerLike;
}): Observable<MessageEvent> {
  const { compute, changes$, closeAfterMs, timing, scheduler } = opts;
  return defer(() => {
    let last: string | null = null;
    const triggers = merge(
      of('start' as const),
      changes$.pipe(
        debounceTime(timing.debounceMs, scheduler),
        map(() => 'change' as const),
      ),
      interval(timing.heartbeatMs, scheduler).pipe(map(() => 'tick' as const)),
    );
    return triggers.pipe(
      switchMap((trigger) =>
        from(compute()).pipe(
          switchMap((snapshot): Observable<MessageEvent> => {
            const key = keyOf(snapshot);
            if (key !== last) {
              last = key;
              return of({ type: POSITION_EVENT, data: snapshot });
            }
            return trigger === 'tick'
              ? of({ comment: HEARTBEAT_COMMENT })
              : EMPTY;
          }),
        ),
      ),
      takeWhile(
        (e) => (e.data as QueuePositionDto | undefined)?.phase !== 'DONE',
        true,
      ),
      takeUntil(timer(Math.max(0, closeAfterMs), scheduler)),
    );
  });
}
