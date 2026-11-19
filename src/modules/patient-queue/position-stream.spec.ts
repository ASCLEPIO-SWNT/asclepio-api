import { of, type Observable } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import type { QueuePositionDto } from './dto/patient-queue.dto.js';
import {
  HEARTBEAT_COMMENT,
  POSITION_EVENT,
  positionStream,
  STREAM_TIMING,
} from './position-stream.js';

function snap(
  position: number | null,
  phase: QueuePositionDto['phase'] = 'WAITING_TRIAGE',
  serverNow = '2026-11-18T15:00:00.000Z',
): QueuePositionDto {
  return {
    phase,
    position,
    aheadCount: position === null ? null : position - 1,
    estimate: null,
    estimateBasis: position === null ? null : 'INSUFFICIENT_DATA',
    serverNow,
  };
}

/** F-10-api (T5): el stream de D3 con el scheduler virtual de rxjs y los tiempos reales (1 s y 15 s). */
describe('positionStream (F-10-api)', () => {
  let scheduler: TestScheduler;
  beforeEach(() => {
    scheduler = new TestScheduler((actual, expected) =>
      expect(actual).toEqual(expected),
    );
  });

  /** compute que devuelve, en orden, las instantáneas dadas (y repite la última). */
  function sequence(...snaps: QueuePositionDto[]) {
    let i = 0;
    const calls: number[] = [];
    return {
      calls,
      compute: () => {
        calls.push(scheduler.now());
        return of(snaps[Math.min(i++, snaps.length - 1)]);
      },
    };
  }

  const position = (s: QueuePositionDto) => ({ type: POSITION_EVENT, data: s });
  const ping = { comment: HEARTBEAT_COMMENT };
  const HOUR = 3_600_000;

  function run(
    compute: () => Observable<QueuePositionDto>,
    changes$: Observable<unknown>,
    closeAfterMs = 8 * HOUR,
  ) {
    return positionStream({
      compute,
      changes$,
      closeAfterMs,
      timing: STREAM_TIMING,
      scheduler,
    });
  }

  it('R7: emite de inmediato (t = 0) un evento position con la instantánea', () => {
    scheduler.run(({ expectObservable, cold }) => {
      const { compute } = sequence(snap(3));
      expectObservable(run(compute, cold('-')), '^ 100ms !').toBe('a', {
        a: position(snap(3)),
      });
    });
  });

  it('R8: un cambio emite la nueva instantánea 1 s después (≤ 2 s); una ráfaga se agrupa en un solo recálculo', () => {
    scheduler.run(({ expectObservable, cold }) => {
      const { compute, calls } = sequence(snap(3), snap(2));
      // Ráfaga de tres cambios a los 100, 200 y 300 ms: un solo recálculo a los 1300 ms.
      const changes = cold('100ms a 99ms b 99ms c');
      expectObservable(run(compute, changes), '^ 5s !').toBe('a 1299ms b', {
        a: position(snap(3)),
        b: position(snap(2)),
      });
      scheduler.flush();
      expect(calls).toEqual([0, 1300]);
    });
  });

  it('R8: si la instantánea no cambió (solo serverNow), un cambio no emite nada', () => {
    scheduler.run(({ expectObservable, cold }) => {
      const { compute } = sequence(
        snap(2),
        snap(2, 'WAITING_TRIAGE', '2026-11-18T15:00:01.000Z'),
      );
      expectObservable(run(compute, cold('500ms a')), '^ 5s !').toBe('a', {
        a: position(snap(2)),
      });
    });
  });

  it('R9: cada 15 s recalcula; sin cambios envía un comentario de latido y con cambios, la instantánea', () => {
    scheduler.run(({ expectObservable, cold }) => {
      const { compute, calls } = sequence(snap(3), snap(3), snap(1));
      expectObservable(run(compute, cold('-')), '^ 31s !').toBe(
        'a 14999ms p 14999ms b',
        { a: position(snap(3)), p: ping, b: position(snap(1)) },
      );
      scheduler.flush();
      expect(calls).toEqual([0, 15_000, 30_000]);
    });
  });

  it('R10: al llegar a DONE emite la instantánea DONE y cierra el stream', () => {
    scheduler.run(({ expectObservable, cold }) => {
      const { compute } = sequence(snap(1), snap(null, 'DONE'));
      expectObservable(run(compute, cold('200ms a'))).toBe('a 1199ms (d|)', {
        a: position(snap(1)),
        d: position(snap(null, 'DONE')),
      });
    });
  });

  it('R11: se cierra cuando vence el token (closeAfterMs), aunque no haya cambios', () => {
    scheduler.run(({ expectObservable, cold }) => {
      const { compute } = sequence(snap(2));
      expectObservable(run(compute, cold('-'), 20_000)).toBe(
        'a 14999ms p 4999ms |',
        { a: position(snap(2)), p: ping },
      );
    });
  });
});
