import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdvisorResult } from './triage-advisor.js';
import type { TriageInputSnapshot } from './triage-input.js';
import { parseVignette, runEval, type Vignette } from './vignette-eval.js';

function vignette(
  id: string,
  level: number,
  acceptable: number[],
  reviewed: string | null = null,
): Vignette {
  return parseVignette({
    id,
    title: `DEV ${id}`,
    input: {
      age_years: 50,
      sex: 'M',
      chief_complaint_text: `caso ${id}`,
      vital_signs: { heart_rate: 90 },
      symptom_findings: [],
    },
    expected: {
      level,
      acceptable_levels: acceptable,
      must_mention_factors: [],
    },
    source: 'BORRADOR — revisar con asesor clínico',
    reviewed_by: reviewed,
  });
}

/** Advisor falso: devuelve el nivel programado por chief_complaint_text (null → TIMEOUT). */
function fakeAdvisor(levels: Record<string, number | null>, guard = false) {
  const seen: TriageInputSnapshot[] = [];
  return {
    seen,
    advise(s: TriageInputSnapshot): Promise<AdvisorResult> {
      seen.push(s);
      const level = levels[s.chief_complaint_text];
      const ok = level !== null && level !== undefined;
      return Promise.resolve({
        status: ok ? 'OK' : 'TIMEOUT',
        llmLevel: ok ? level : null,
        suggestedLevel: ok ? level : null,
        explanation: ok ? { summary: 'x', factors: [] } : null,
        guardApplied: ok && guard,
        guardReasons: [],
        provider: 'GROQ',
        model: 'openai/gpt-oss-120b',
        promptVersion: 'triage-v1',
        rawResponse: null,
        tokensIn: null,
        tokensOut: null,
        latencyMs: 1234,
        attempts: [],
      });
    },
  };
}

async function run(
  vignettes: Vignette[],
  levels: Record<string, number | null>,
  guard = false,
) {
  const lines: string[] = [];
  const advisor = fakeAdvisor(levels, guard);
  const code = await runEval(advisor, vignettes, (l) => lines.push(l));
  return { code, lines, text: lines.join('\n'), advisor };
}

describe('ai:eval (D14)', () => {
  it('R30: imprime por viñeta el nivel, acierto, subclasificación, guard, proveedor, modelo, prompt_version, latencia y si está revisada', async () => {
    const { lines } = await run(
      [
        vignette('V-901', 2, [1, 2]),
        vignette('V-902', 4, [3, 4], 'DEV-revisor'),
      ],
      { 'caso V-901': 2, 'caso V-902': 5 },
      true,
    );
    const v1 = lines.find((l) => l.startsWith('V-901'))!;
    const v2 = lines.find((l) => l.startsWith('V-902'))!;
    for (const part of [
      'nivel=2',
      'esperado=2',
      'acierto=sí',
      'subclasifica=no',
      'guard=sí',
      'proveedor=GROQ',
      'modelo=openai/gpt-oss-120b',
      'prompt=triage-v1',
      'latencia=1234ms',
      'revisada=no',
    ]) {
      expect([part, v1.includes(part)]).toEqual([part, true]);
    }
    for (const part of [
      'nivel=5',
      'acierto=no',
      'subclasifica=sí',
      'revisada=sí',
    ]) {
      expect([part, v2.includes(part)]).toEqual([part, true]);
    }
  });

  it('R30: imprime al final el porcentaje de acierto y de subclasificación; una sugerencia sin nivel no acierta', async () => {
    const { text } = await run(
      [
        vignette('V-901', 2, [1, 2]),
        vignette('V-902', 3, [2, 3]),
        vignette('V-903', 4, [3, 4]),
        vignette('V-904', 5, [4, 5]),
      ],
      { 'caso V-901': 1, 'caso V-902': 4, 'caso V-903': null, 'caso V-904': 5 },
    );
    expect(text).toMatch(/V-903.*nivel=— \(TIMEOUT\).*acierto=no/);
    expect(text).toContain('Acierto: 50.0 % (2/4)');
    expect(text).toContain('Subclasificación: 25.0 % (1/4)');
  });

  it('R30: usa el mismo flujo del advisor con la entrada de la viñeta completada con null en lo que falta', async () => {
    const { advisor } = await run([vignette('V-901', 2, [1, 2])], {
      'caso V-901': 2,
    });
    expect(advisor.seen[0]).toEqual({
      age_years: 50,
      sex: 'M',
      chief_complaint_text: 'caso V-901',
      complaint_source: 'TYPED',
      vital_signs: {
        respiratory_rate: null,
        spo2: null,
        supplemental_oxygen: null,
        systolic_bp: null,
        diastolic_bp: null,
        heart_rate: 90,
        consciousness: null,
        temperature_c: null,
        glucose_mg_dl: null,
      },
      symptom_findings: [],
    });
  });

  it('R31: termina con código ≠ 0 si una viñeta revisada de nivel 1–2 subclasifica o queda sin nivel', async () => {
    const reviewed = 'DEV-revisor';
    expect(
      (await run([vignette('V-901', 2, [1, 2], reviewed)], { 'caso V-901': 3 }))
        .code,
    ).not.toBe(0);
    expect(
      (
        await run([vignette('V-901', 1, [1], reviewed)], {
          'caso V-901': null,
        })
      ).code,
    ).not.toBe(0);
    // Revisada de nivel 3 que subclasifica: no bloquea (el umbral es para I–II).
    expect(
      (await run([vignette('V-901', 3, [2, 3], reviewed)], { 'caso V-901': 5 }))
        .code,
    ).toBe(0);
    // Revisada de nivel 2 que acierta.
    expect(
      (await run([vignette('V-901', 2, [1, 2], reviewed)], { 'caso V-901': 1 }))
        .code,
    ).toBe(0);
  });

  it('R31: con ninguna viñeta revisada termina con 0 y avisa de que el umbral aún no es vinculante', async () => {
    const { code, text } = await run([vignette('V-901', 1, [1])], {
      'caso V-901': 4,
    });
    expect(code).toBe(0);
    expect(text).toMatch(/ninguna viñeta está revisada/i);
    expect(text).toMatch(/no es vinculante/);
  });

  it('R30: las 20 viñetas de ai/vignettes son borradores sintéticos válidos, 4 por nivel, sin revisar', () => {
    const dir = join(process.cwd(), 'ai', 'vignettes');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(20);
    const byLevel = new Map<number, number>();
    for (const f of files) {
      const v = parseVignette(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      expect(f).toBe(`${v.id}.json`);
      expect(v.reviewedBy).toBeNull();
      expect(v.source).toBe('BORRADOR — revisar con asesor clínico');
      expect(v.acceptableLevels).toContain(v.expectedLevel);
      byLevel.set(v.expectedLevel, (byLevel.get(v.expectedLevel) ?? 0) + 1);
    }
    expect([...byLevel.entries()].sort()).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
    ]);
  });

  it('R32: ni npm test, ni npm run test:int, ni init.sh ejecutan ai:eval', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    for (const name of [
      'test',
      'test:unit',
      'test:e2e',
      'test:int',
      'pretest',
    ]) {
      expect([name, /ai[:-]eval/.test(pkg.scripts[name] ?? '')]).toEqual([
        name,
        false,
      ]);
    }
    expect(pkg.scripts['ai:eval']).toBe(
      'npm run -s build && node dist/scripts/ai-eval.js',
    );
    for (const file of ['init.sh', 'scripts/test-int.sh']) {
      const code = readFileSync(join(process.cwd(), file), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'));
      expect([file, code.some((l) => /ai[:-]eval/.test(l))]).toEqual([
        file,
        false,
      ]);
    }
  });
});
