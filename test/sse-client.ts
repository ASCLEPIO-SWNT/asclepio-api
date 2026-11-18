import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

export interface SseMessage {
  /** ms desde la apertura. */
  at: number;
  event?: string;
  data?: unknown;
  comment?: string;
}

/** Cliente SSE mínimo para las pruebas (fetch + lectura del cuerpo): acumula eventos y comentarios. */
export interface SseConnection {
  status: number;
  headers: Headers;
  messages: SseMessage[];
  /** Se resuelve cuando el servidor cierra el stream. */
  closed: Promise<number>;
  /** Espera hasta que haya `n` mensajes que cumplan `pred` (o falla a los `timeoutMs`). */
  waitFor(
    pred: (m: SseMessage) => boolean,
    n?: number,
    timeoutMs?: number,
  ): Promise<SseMessage[]>;
  close(): void;
}

function parse(block: string, at: number): SseMessage {
  const m: SseMessage = { at };
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) m.comment = line.slice(1).trim();
    else if (line.startsWith('event:')) m.event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length) m.data = JSON.parse(data.join('\n'));
  return m;
}

/** Abre `path` (con el prefijo /api/v1) en el servidor de la app, que debe estar escuchando (app.listen(0)). */
export async function openSse(
  app: INestApplication,
  path: string,
  token?: string,
): Promise<SseConnection> {
  const { port } = (
    app.getHttpServer() as { address(): AddressInfo }
  ).address();
  const abort = new AbortController();
  const start = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: abort.signal,
  });
  const messages: SseMessage[] = [];
  const closed = (async () => {
    if (!res.body) return Date.now() - start;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i).trim();
          buf = buf.slice(i + 2);
          if (block) messages.push(parse(block, Date.now() - start));
        }
      }
    } catch {
      // Abortado por la prueba.
    }
    return Date.now() - start;
  })();
  return {
    status: res.status,
    headers: res.headers,
    messages,
    closed,
    close: () => abort.abort(),
    async waitFor(pred, n = 1, timeoutMs = 5000) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.filter(pred);
        if (found.length >= n) return found;
        if (Date.now() > until) {
          throw new Error(
            `SSE: ${found.length}/${n} mensajes esperados; recibidos ${JSON.stringify(messages)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}

export const isPosition = (m: SseMessage) => m.event === 'position';
