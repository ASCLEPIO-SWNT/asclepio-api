/**
 * Saneamiento del texto libre antes de enviarlo al LLM (R9 de F-04-api, D8, PA-F04-7). Pura y determinista.
 *
 * Se compara sobre el texto normalizado (NFD sin tildes y en minúsculas) y se reemplaza en el original por
 * `[REDACTADO]`: (a) el nombre completo; (b) cada palabra del nombre de 3 o más letras que no sea un conector
 * (del, las, los, san), como palabra completa; (c) el número de documento, aunque lleve separadores ".", "-" o
 * espacios. Riesgo residual aceptado (PA-F04-7): no detecta nombres de terceros.
 */

export const REDACTED = '[REDACTADO]';

const CONNECTORS = new Set(['del', 'las', 'los', 'san']);
const MIN_WORD_LETTERS = 3;

export interface RedactionTarget {
  fullName: string | null;
  documentNumber: string | null;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Texto normalizado y, por cada unidad del normalizado, el índice [inicio, fin) del carácter original. */
function normalizeWithMap(text: string): {
  norm: string;
  start: number[];
  end: number[];
} {
  let norm = '';
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  for (const ch of text) {
    const n = normalize(ch);
    for (let k = 0; k < n.length; k++) {
      start.push(i);
      end.push(i + ch.length);
    }
    norm += n;
    i += ch.length;
  }
  return { norm, start, end };
}

function patterns(target: RedactionTarget): RegExp[] {
  const out: RegExp[] = [];
  const words = normalize(target.fullName ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length) {
    // (a) nombre completo, con cualquier separación entre palabras.
    out.push(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${words.map(escapeRegExp).join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}])`,
        'gu',
      ),
    );
    // (b) palabras sueltas de 3 o más letras que no son conectores.
    for (const w of words) {
      if (w.length >= MIN_WORD_LETTERS && !CONNECTORS.has(w)) {
        out.push(
          new RegExp(
            `(?<![\\p{L}\\p{N}])${escapeRegExp(w)}(?![\\p{L}\\p{N}])`,
            'gu',
          ),
        );
      }
    }
  }
  // (c) documento: sus caracteres alfanuméricos, admitiendo ".", "-" o espacio entre ellos.
  const doc = [...normalize(target.documentNumber ?? '')].filter((c) =>
    /[\p{L}\p{N}]/u.test(c),
  );
  if (doc.length) {
    out.push(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${doc.map(escapeRegExp).join('[.\\- ]?')}(?![\\p{L}\\p{N}])`,
        'gu',
      ),
    );
  }
  return out;
}

/** Devuelve el texto con el nombre y el documento conocidos reemplazados por [REDACTADO]. NN → sin cambios. */
export function redact(text: string, target: RedactionTarget): string {
  const regexes = patterns(target);
  if (!regexes.length || !text) return text;
  const { norm, start, end } = normalizeWithMap(text);
  const spans: [number, number][] = [];
  for (const re of regexes) {
    for (const m of norm.matchAll(re)) {
      if (!m[0].length) continue;
      const a = m.index;
      const b = a + m[0].length - 1;
      spans.push([start[a], end[b]]);
    }
  }
  if (!spans.length) return text;
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] < last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  let out = '';
  let cursor = 0;
  for (const [a, b] of merged) {
    out += text.slice(cursor, a) + REDACTED;
    cursor = b;
  }
  return out + text.slice(cursor);
}
