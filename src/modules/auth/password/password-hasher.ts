import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

const PREFIX = 'scrypt';
// Parámetros OWASP para scrypt (D1): N = 2^17, r = 8, p = 1; sal de 16 bytes y clave de 64 bytes.
const N = 2 ** 17;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAXMEM = 256 * 1024 * 1024;
// Hash con la forma correcta para gastar el mismo tiempo cuando la cuenta no existe (D8).
const DUMMY_HASH = [
  PREFIX,
  N,
  R,
  P,
  Buffer.alloc(SALT_BYTES).toString('base64'),
  Buffer.alloc(KEY_BYTES).toString('base64'),
].join('$');

function derive(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/**
 * Hash de contraseñas con scrypt de node:crypto (D1, R27). Formato: scrypt$N$r$p$<sal b64>$<hash b64>.
 * Los parámetros viajan en el hash, así que se pueden subir sin migrar datos.
 */
@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, KEY_BYTES, {
      N,
      r: R,
      p: P,
      maxmem: MAXMEM,
    });
    return [
      PREFIX,
      N,
      R,
      P,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== PREFIX) return false;
    const [n, r, p] = parts.slice(1, 4).map(Number);
    if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    try {
      const key = await derive(password, salt, expected.length, {
        N: n,
        r,
        p,
        maxmem: MAXMEM,
      });
      return timingSafeEqual(key, expected);
    } catch {
      return false;
    }
  }

  /** Para cuentas inexistentes: mismo coste que verify, resultado siempre false. */
  async verifyDummy(password: string): Promise<false> {
    await this.verify(password, DUMMY_HASH);
    return false;
  }
}
