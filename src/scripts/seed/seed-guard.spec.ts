import { assertSeedTarget, SeedGuardError } from './seed-guard.js';

const LOCAL = 'postgresql://u:p@localhost:54329/db';
const LOOPBACK = 'postgresql://u:p@127.0.0.1:5432/db';
const REMOTE = 'postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/db';

describe('assertSeedTarget (guardián del seed, F-09-api)', () => {
  it('F-09.AC1: acepta DATABASE_URL y DIRECT_URL en localhost o 127.0.0.1', () => {
    expect(() =>
      assertSeedTarget({ DATABASE_URL: LOCAL, DIRECT_URL: LOOPBACK }),
    ).not.toThrow();
    expect(() => assertSeedTarget({ DATABASE_URL: LOOPBACK })).not.toThrow();
  });

  it('F-09.AC1: aborta si DATABASE_URL o DIRECT_URL apuntan a otro host, sin mostrar la URL', () => {
    for (const env of [
      { DATABASE_URL: REMOTE },
      { DATABASE_URL: LOCAL, DIRECT_URL: REMOTE },
    ]) {
      let error: unknown;
      try {
        assertSeedTarget(env);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SeedGuardError);
      expect((error as Error).message).not.toContain('supabase');
    }
  });

  it('F-09.AC1: aborta sin DATABASE_URL o con una URL inválida', () => {
    expect(() => assertSeedTarget({})).toThrow(SeedGuardError);
    expect(() => assertSeedTarget({ DATABASE_URL: 'no-es-url' })).toThrow(
      SeedGuardError,
    );
  });

  it('F-09.AC1: ALLOW_REMOTE_SEED=1 (exactamente) autoriza una base remota', () => {
    expect(() =>
      assertSeedTarget({ DATABASE_URL: REMOTE, ALLOW_REMOTE_SEED: '1' }),
    ).not.toThrow();
    for (const v of ['true', 'yes', '0', '']) {
      expect(() =>
        assertSeedTarget({ DATABASE_URL: REMOTE, ALLOW_REMOTE_SEED: v }),
      ).toThrow(SeedGuardError);
    }
  });
});
