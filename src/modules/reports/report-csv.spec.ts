import { bogotaIso, CSV_COLUMNS, neutralize, toCsv } from './report-csv.js';
import { buildRows, type ReportRow } from './report-rows.js';

const ROW: ReportRow = {
  encounterId: '11111111-1111-4111-8111-111111111111',
  siteName: 'DEV Sede Norte',
  status: 'CLOSED',
  origin: 'PRE_REGISTRATION',
  complaintSource: 'VOICE_ON_DEVICE',
  arrivalAt: new Date('2026-11-11T00:42:00.000Z'),
  triagedAt: new Date('2026-11-11T00:50:30.000Z'),
  inCareAt: new Date('2026-11-11T01:15:30.000Z'),
  closedAt: new Date('2026-11-11T02:00:00.000Z'),
  finalLevel: 2,
  decisionAction: 'CORRECT',
  suggestionStatus: 'OK',
  suggestedLevel: 3,
  llmLevel: 4,
  guardApplied: true,
  provider: 'OPENROUTER',
  minutesToTriage: 8.5,
  minutesTriageToCare: 25,
  compliant: true,
};

const EMPTY: ReportRow = {
  ...ROW,
  encounterId: '22222222-2222-4222-8222-222222222222',
  siteName: 'DEV Sede Sur',
  status: 'WAITING_TRIAGE',
  origin: 'DIRECT',
  complaintSource: 'TYPED',
  triagedAt: null,
  inCareAt: null,
  closedAt: null,
  finalLevel: null,
  decisionAction: null,
  suggestionStatus: null,
  suggestedLevel: null,
  llmLevel: null,
  guardApplied: null,
  provider: null,
  minutesToTriage: null,
  minutesTriageToCare: null,
  compliant: null,
};

const HEADER =
  'encounter_id,site_name,status,origin,complaint_source,arrival_at,triaged_at,in_care_at,closed_at,final_level,decision_action,suggestion_status,suggested_level,llm_level,guard_applied,provider,minutes_to_triage,minutes_triage_to_care,compliant';

/** Separa un CSV RFC 4180 en filas y celdas (para comprobar el resultado). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

describe('report-csv (F-07-api)', () => {
  it('R11: cabecera exacta en la primera fila, separador coma, fin de línea CRLF y las filas en el orden recibido', () => {
    const csv = toCsv([ROW, EMPTY]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(4); // cabecera, 2 filas y la cadena vacía tras el último CRLF
    expect(lines[3]).toBe('');
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines[1].startsWith(ROW.encounterId + ',')).toBe(true);
    expect(lines[2].startsWith(EMPTY.encounterId + ',')).toBe(true);
    // Sin filas: solo la cabecera.
    expect(toCsv([])).toBe(HEADER + '\r\n');
  });

  it('R12: columnas de D6 en orden, horas ISO-8601 con -05:00, minutos con punto y 1 decimal, booleanos y vacíos', () => {
    expect(CSV_COLUMNS.map((c) => c.header).join(',')).toBe(HEADER);
    const [, full, empty] = parseCsv(toCsv([ROW, EMPTY]));
    expect(full).toEqual([
      ROW.encounterId,
      'DEV Sede Norte',
      'CLOSED',
      'PRE_REGISTRATION',
      'VOICE_ON_DEVICE',
      '2026-11-10T19:42:00-05:00',
      '2026-11-10T19:50:30-05:00',
      '2026-11-10T20:15:30-05:00',
      '2026-11-10T21:00:00-05:00',
      '2',
      'CORRECT',
      'OK',
      '3',
      '4',
      'true',
      'OPENROUTER',
      '8.5',
      '25.0',
      'true',
    ]);
    expect(empty).toEqual([
      EMPTY.encounterId,
      'DEV Sede Sur',
      'WAITING_TRIAGE',
      'DIRECT',
      'TYPED',
      '2026-11-10T19:42:00-05:00',
      ...Array<string>(13).fill(''),
    ]);
    expect(bogotaIso(new Date('2026-01-01T04:59:59.000Z'))).toBe(
      '2025-12-31T23:59:59-05:00',
    );
    // Redondeo de los minutos y compliant false.
    const [, r] = parseCsv(
      toCsv([
        {
          ...ROW,
          minutesToTriage: 1 / 3,
          minutesTriageToCare: 30.04,
          compliant: false,
          guardApplied: false,
        },
      ]),
    );
    expect([r[14], r[16], r[17], r[18]]).toEqual([
      'false',
      '0.3',
      '30.0',
      'false',
    ]);
  });

  it('R14: site_name que empieza por =, +, -, @, tabulador o CR va precedido de comilla simple; comas, comillas y saltos según RFC 4180', () => {
    const names: [string, string][] = [
      ['=HYPERLINK("http://x","y")', '\'=HYPERLINK("http://x","y")'],
      ['+1+2', "'+1+2"],
      ['-2+3', "'-2+3"],
      ['@SUM(A1)', "'@SUM(A1)"],
      ['\tTab', "'\tTab"],
      ['\rCR', "'\rCR"],
      ['Sede, Norte', 'Sede, Norte'],
      ['Sede "Norte"', 'Sede "Norte"'],
      ['Sede\nNorte', 'Sede\nNorte'],
      ['Sede Norte', 'Sede Norte'],
      ["'ya citado", "'ya citado"],
    ];
    for (const [name, expected] of names) {
      expect(neutralize(name)).toBe(expected);
      const csv = toCsv([{ ...ROW, siteName: name }]);
      const parsed = parseCsv(csv);
      expect([name, parsed[1][1]]).toEqual([name, expected]);
      expect(parsed[1]).toHaveLength(CSV_COLUMNS.length);
    }
    // La celda con coma, comillas o salto va entre comillas dobles y las comillas internas se duplican.
    expect(
      toCsv([{ ...ROW, siteName: 'Sede "A", B' }]).split('\r\n')[1],
    ).toContain(',"Sede ""A"", B",');
    expect(toCsv([{ ...ROW, siteName: '=1,2' }]).split('\r\n')[1]).toContain(
      `,"'=1,2",`,
    );
    // Los minutos negativos no son texto: no se neutralizan.
    const [, neg] = parseCsv(toCsv([{ ...ROW, minutesTriageToCare: -1 }]));
    expect(neg[17]).toBe('-1.0');
  });

  it('R13: la fila (ReportRow) no tiene campos de nombre, documento, motivo de consulta, motivo de corrección ni personal', () => {
    const [row] = buildRows(
      [
        {
          id: 'e1',
          siteId: 's1',
          siteName: 'DEV Sede',
          status: 'WAITING_TRIAGE',
          origin: 'DIRECT',
          complaintSource: 'TYPED',
          arrivalAt: new Date(),
          triagedAt: null,
          finalLevel: null,
          inCareAt: null,
          closedAt: null,
        },
      ],
      [],
      [],
    );
    const keys = Object.keys(row).sort();
    expect(keys).toEqual(Object.keys(ROW).sort());
    expect(keys).toHaveLength(CSV_COLUMNS.length);
    for (const key of keys) {
      expect(key).not.toMatch(
        /fullName|patient|document|birth|chiefComplaint|complaintText|reason|decidedBy|triagedBy|registeredBy|requestedBy|user|email/i,
      );
    }
    expect(HEADER).not.toMatch(/name_|full_name|document|reason|patient|text/);
  });
});
