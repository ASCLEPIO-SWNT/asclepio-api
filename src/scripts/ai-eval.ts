// npm run ai:eval → evalúa el prompt y el modelo con las viñetas de ai/vignettes contra el LLM REAL (D14 de F-04-api)
// y, desde F-11-api (T10), el fallback de la entrevista con ai/vignettes/interview.
// Consume tokens: solo se ejecuta a mano cuando cambian el prompt o el modelo; nunca en init.sh ni en las pruebas (R32).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AiCoreModule } from '../modules/ai/ai.module.js';
import { TriageAdvisor } from '../modules/ai/triage-advisor.js';
import { parseVignette, runEval } from '../modules/ai/vignette-eval.js';
import { InterviewAdvisor } from '../modules/interview/interview-advisor.js';
import {
  parseInterviewVignette,
  runInterviewEval,
} from '../modules/interview/interview-eval.js';
import { InterviewCoreModule } from '../modules/interview/interview.module.js';
import { out } from './cli.js';

async function main(): Promise<number> {
  // Mismo patrón que los scripts CLI: process.loadEnvFile no sobrescribe variables ya definidas.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const read = <T>(dir: string, parse: (raw: unknown) => T): T[] =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
  const dir = join(process.cwd(), 'ai', 'vignettes');
  const vignettes = read(dir, parseVignette);
  const interviews = read(join(dir, 'interview'), parseInterviewVignette);
  // AiCoreModule (e InterviewCoreModule, que lo importa) valida GROQ_* y OPENROUTER_* (R29) y no usa la base de datos.
  const app = await NestFactory.createApplicationContext(InterviewCoreModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    out(`ai:eval — ${vignettes.length} viñetas de triage`);
    const triage = await runEval(
      app.select(AiCoreModule).get(TriageAdvisor),
      vignettes,
      out,
    );
    out('');
    out(`ai:eval — ${interviews.length} viñetas de entrevista (interview-v1)`);
    const interview = await runInterviewEval(
      app.get(InterviewAdvisor),
      interviews,
      out,
    );
    return Math.max(triage, interview);
  } finally {
    await app.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    // Solo el mensaje propio (nombra variables o viñetas, nunca valores ni respuestas del LLM).
    process.stderr.write(
      `ai:eval falló: ${e instanceof Error ? e.message : 'error desconocido'}\n`,
    );
    process.exitCode = 1;
  },
);
