import type { ReportRow } from './report-rows.js';
import { round1 } from './report-stats.js';

/**
 * CSV de atenciones (F-07-api, D6, D7, R11–R14). Formato INTERNO documentado en docs/reports-csv.md: no es el formato
 * oficial de la Res. 373 ni de SISPRO (PA-F07-1). Puro: RFC 4180, separador coma, CRLF y cabecera en la primera fila.
 */

const BOGOTA_OFFSET_MS = 5 * 3_600_000;
/** Caracteres con los que una hoja de cálculo interpreta una celda como fórmula (R14). */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

type Cell = string | number | boolean | Date | null;
interface Column {
  header: string;
  value: (r: ReportRow) => Cell;
  kind: 'text' | 'enum' | 'id' | 'datetime' | 'integer' | 'minutes' | 'boolean';
}

/** Columnas de D6, en este orden. */
export const CSV_COLUMNS: readonly Column[] = [
  { header: 'encounter_id', kind: 'id', value: (r) => r.encounterId },
  { header: 'site_name', kind: 'text', value: (r) => r.siteName },
  { header: 'status', kind: 'enum', value: (r) => r.status },
  { header: 'origin', kind: 'enum', value: (r) => r.origin },
  { header: 'complaint_source', kind: 'enum', value: (r) => r.complaintSource },
  { header: 'arrival_at', kind: 'datetime', value: (r) => r.arrivalAt },
  { header: 'triaged_at', kind: 'datetime', value: (r) => r.triagedAt },
  { header: 'in_care_at', kind: 'datetime', value: (r) => r.inCareAt },
  { header: 'closed_at', kind: 'datetime', value: (r) => r.closedAt },
  { header: 'final_level', kind: 'integer', value: (r) => r.finalLevel },
  { header: 'decision_action', kind: 'enum', value: (r) => r.decisionAction },
  {
    header: 'suggestion_status',
    kind: 'enum',
    value: (r) => r.suggestionStatus,
  },
  {
    header: 'suggested_level',
    kind: 'integer',
    value: (r) => r.suggestedLevel,
  },
  { header: 'llm_level', kind: 'integer', value: (r) => r.llmLevel },
  { header: 'guard_applied', kind: 'boolean', value: (r) => r.guardApplied },
  { header: 'provider', kind: 'enum', value: (r) => r.provider },
  {
    header: 'minutes_to_triage',
    kind: 'minutes',
    value: (r) => r.minutesToTriage,
  },
  {
    header: 'minutes_triage_to_care',
    kind: 'minutes',
    value: (r) => r.minutesTriageToCare,
  },
  { header: 'compliant', kind: 'boolean', value: (r) => r.compliant },
];

/** ISO-8601 en hora de Bogotá con desfase fijo −05:00 y precisión de segundos (2026-11-10T19:42:00-05:00). */
export function bogotaIso(d: Date): string {
  return (
    new Date(d.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 19) +
    '-05:00'
  );
}

/** Neutraliza la inyección de fórmulas (R14, D7): antepone ' si la celda de texto empieza por = + - @ TAB o CR. */
export function neutralize(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Comillas RFC 4180 si la celda lleva coma, comillas, CR o LF; las comillas internas se duplican. */
function quote(cell: string): string {
  return NEEDS_QUOTES.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function format(c: Column, v: Cell): string {
  if (v === null) return '';
  switch (c.kind) {
    case 'text':
      return neutralize(String(v));
    case 'datetime':
      return bogotaIso(v as Date);
    case 'minutes':
      return round1(v as number).toFixed(1);
    case 'boolean':
      return v ? 'true' : 'false';
    default:
      return String(v);
  }
}

/** CSV completo: cabecera y una línea por fila, cada una terminada en CRLF (R11, R12). */
export function toCsv(rows: readonly ReportRow[]): string {
  const lines = [
    CSV_COLUMNS.map((c) => c.header).join(','),
    ...rows.map((r) =>
      CSV_COLUMNS.map((c) => quote(format(c, c.value(r)))).join(','),
    ),
  ];
  return lines.map((l) => `${l}\r\n`).join('');
}
