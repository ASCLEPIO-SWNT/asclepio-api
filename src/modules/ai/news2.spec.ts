import { NEWS2_TABLE, scoreNews2 } from './news2.js';
import type { SnapshotVitalSigns } from './triage-input.js';

/** Toma con todos los parámetros en 0 puntos (FR 16, SpO₂ 98, aire ambiente, PAS 120, FC 70, alerta, 37.0 °C). */
const NORMAL: SnapshotVitalSigns = {
  respiratory_rate: 16,
  spo2: 98,
  supplemental_oxygen: false,
  systolic_bp: 120,
  diastolic_bp: 80,
  heart_rate: 70,
  consciousness: 'A',
  temperature_c: 37.0,
  glucose_mg_dl: 100,
};

const pointsOf = (over: Partial<SnapshotVitalSigns>, field: string) =>
  scoreNews2({ ...NORMAL, ...over }).parameters.find(
    (p) => p.field === `vital_signs.${field}`,
  )?.points;

describe('NEWS2 (RCP 2017, escala 1 de SpO₂) — PROVISIONAL', () => {
  it('R17: una toma normal suma 0 y puntúa los siete parámetros', () => {
    const r = scoreNews2(NORMAL);
    expect(r.total).toBe(0);
    expect(r.parameters.map((p) => p.field).sort()).toEqual([
      'vital_signs.consciousness',
      'vital_signs.heart_rate',
      'vital_signs.respiratory_rate',
      'vital_signs.spo2',
      'vital_signs.supplemental_oxygen',
      'vital_signs.systolic_bp',
      'vital_signs.temperature_c',
    ]);
  });

  it.each([
    [8, 3],
    [9, 1],
    [11, 1],
    [12, 0],
    [20, 0],
    [21, 2],
    [24, 2],
    [25, 3],
  ])('R17: frecuencia respiratoria %p rpm → %p puntos', (value, points) => {
    expect(pointsOf({ respiratory_rate: value }, 'respiratory_rate')).toBe(
      points,
    );
  });

  it.each([
    [91, 3],
    [92, 2],
    [93, 2],
    [94, 1],
    [95, 1],
    [96, 0],
  ])('R17: SpO₂ %p %% → %p puntos', (value, points) => {
    expect(pointsOf({ spo2: value }, 'spo2')).toBe(points);
  });

  it('R17: oxígeno suplementario → 2 puntos; aire ambiente → 0', () => {
    expect(pointsOf({ supplemental_oxygen: true }, 'supplemental_oxygen')).toBe(
      2,
    );
    expect(
      pointsOf({ supplemental_oxygen: false }, 'supplemental_oxygen'),
    ).toBe(0);
  });

  it.each([
    [90, 3],
    [91, 2],
    [100, 2],
    [101, 1],
    [110, 1],
    [111, 0],
    [219, 0],
    [220, 3],
  ])('R17: PAS %p mmHg → %p puntos', (value, points) => {
    expect(pointsOf({ systolic_bp: value }, 'systolic_bp')).toBe(points);
  });

  it.each([
    [40, 3],
    [41, 1],
    [50, 1],
    [51, 0],
    [90, 0],
    [91, 1],
    [110, 1],
    [111, 2],
    [130, 2],
    [131, 3],
  ])('R17: FC %p lpm → %p puntos', (value, points) => {
    expect(pointsOf({ heart_rate: value }, 'heart_rate')).toBe(points);
  });

  it.each([
    ['A', 0],
    ['C', 3],
    ['V', 3],
    ['P', 3],
    ['U', 3],
  ] as const)('R17: conciencia %p → %p puntos', (value, points) => {
    expect(pointsOf({ consciousness: value }, 'consciousness')).toBe(points);
  });

  it.each([
    [35.0, 3],
    [35.1, 1],
    [36.0, 1],
    [36.1, 0],
    [38.0, 0],
    [38.1, 1],
    [39.0, 1],
    [39.1, 2],
  ])('R17: temperatura %p °C → %p puntos', (value, points) => {
    expect(pointsOf({ temperature_c: value }, 'temperature_c')).toBe(points);
  });

  it('R17: el total es la suma de los parámetros (caso 7:42: FR 22, SpO₂ 94, PAS 150, FC 112 → 2 + 1 + 0 + 2 = 5)', () => {
    const r = scoreNews2({
      ...NORMAL,
      respiratory_rate: 22,
      spo2: 94,
      systolic_bp: 150,
      heart_rate: 112,
    });
    expect(r.total).toBe(5);
    const all = scoreNews2({
      respiratory_rate: 30,
      spo2: 85,
      supplemental_oxygen: true,
      systolic_bp: 80,
      diastolic_bp: null,
      heart_rate: 140,
      consciousness: 'U',
      temperature_c: 34.0,
      glucose_mg_dl: null,
    });
    expect(all.total).toBe(3 + 3 + 2 + 3 + 3 + 3 + 3);
  });

  it('R17: un parámetro ausente (null) no puntúa ni se lista; la diastólica y la glucemia nunca puntúan', () => {
    const r = scoreNews2({
      ...NORMAL,
      heart_rate: null,
      diastolic_bp: 30,
      glucose_mg_dl: 30,
    });
    expect(r.parameters.map((p) => p.field)).not.toContain(
      'vital_signs.heart_rate',
    );
    expect(r.total).toBe(0);
  });

  it('R17: NEWS2_TABLE cubre exactamente los siete parámetros de NEWS2', () => {
    expect(Object.keys(NEWS2_TABLE).sort()).toEqual([
      'consciousness',
      'heart_rate',
      'respiratory_rate',
      'spo2',
      'supplemental_oxygen',
      'systolic_bp',
      'temperature_c',
    ]);
  });
});
