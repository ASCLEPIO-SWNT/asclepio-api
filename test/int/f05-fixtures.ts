import type { PrismaService } from '../../src/common/prisma/prisma.service.js';

export type SuggestionStatusName =
  'OK' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'FAILED';

/**
 * Inserta una sugerencia de triage directamente (como asclepio_app, que tiene INSERT en triage_suggestions), sin
 * pasar por el LLM: ninguna prueba de F-05 llama a Groq ni a OpenRouter. En OK, llmLevel ≥ suggestedLevel (un guard
 * solo sube la gravedad). Las filas no se borran (append-only, FK RESTRICT).
 */
export async function insertSuggestion(
  prisma: PrismaService,
  s: {
    tenantId: string;
    encounterId: string;
    requestedBy: string;
    createdAt: Date;
    status?: SuggestionStatusName;
    suggestedLevel?: number;
    llmLevel?: number;
  },
): Promise<string> {
  const status = s.status ?? 'OK';
  const ok = status === 'OK';
  const suggestedLevel = ok ? (s.suggestedLevel ?? 3) : null;
  const llmLevel = ok ? (s.llmLevel ?? suggestedLevel) : null;
  const { id } = await prisma.triageSuggestion.create({
    data: {
      tenantId: s.tenantId,
      encounterId: s.encounterId,
      requestedBy: s.requestedBy,
      inputSnapshot: {},
      status,
      llmLevel,
      suggestedLevel,
      explanation: ok ? { summary: 'DEV-test', factors: [] } : undefined,
      guardApplied: ok && llmLevel !== suggestedLevel,
      guardReasons: [],
      promptVersion: 'triage-v1',
      latencyMs: 1,
      attempts: [],
      createdAt: s.createdAt,
    },
    select: { id: true },
  });
  return id;
}
