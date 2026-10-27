import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module.js';

export const DEV_PREFIX = 'DEV-';

/** Fallo de validación de argumentos: el script termina con código 1 sin tocar la base. */
export class CliError extends Error {}

export function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** Mientras NODE_ENV no sea production, los datos creados por CLI llevan el prefijo DEV- (R43, R51). */
export function requireDevPrefix(label: string, value: string): void {
  if (process.env.NODE_ENV !== 'production' && !value.startsWith(DEV_PREFIX)) {
    throw new CliError(
      `${label} debe empezar por "${DEV_PREFIX}" mientras NODE_ENV no sea production.`,
    );
  }
}

export function parseCliArgs<K extends string>(
  names: readonly K[],
): Partial<Record<K, string>> {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        names.map((n) => [n, { type: 'string' as const }]),
      ),
      strict: true,
      allowPositionals: false,
    });
    return values as Partial<Record<K, string>>;
  } catch {
    throw new CliError(
      `Argumentos inválidos. Se admiten: ${names.map((n) => `--${n}`).join(', ')}.`,
    );
  }
}

/**
 * Ejecuta un script CLI con el contexto de aplicación de Nest. Nunca imprime trazas ni mensajes internos
 * (podrían contener datos personales, R35): solo el tipo de error.
 */
export async function runCli(
  main: (ctx: () => Promise<INestApplicationContext>) => Promise<void>,
): Promise<void> {
  // ponytail: mismo patrón que main.ts; process.loadEnvFile no sobrescribe variables ya definidas.
  if (existsSync('.env')) process.loadEnvFile('.env');
  let app: INestApplicationContext | undefined;
  try {
    await main(async () => {
      app ??= await NestFactory.createApplicationContext(CliModule, {
        logger: false,
        abortOnError: false,
      });
      return app;
    });
    process.exitCode = 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`Error: ${e.message}\n`);
    } else {
      const code = (e as { code?: unknown }).code;
      process.stderr.write(
        `Error inesperado (${e instanceof Error ? e.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}).\n`,
      );
    }
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

/** Lee la contraseña por la entrada estándar (D20): sin eco si es una TTY; si no, la primera línea. */
export async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) {
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    return new Promise((resolve, reject) => {
      let value = '';
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n' || ch === '\u0004') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            process.stderr.write('\n');
            resolve(value);
            return;
          }
          if (ch === '\u0003') {
            stdin.setRawMode(false);
            reject(new CliError('Cancelado.'));
            return;
          }
          if (ch === '\u007f') value = value.slice(0, -1);
          else value += ch;
        }
      };
      stdin.on('data', onData);
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}
