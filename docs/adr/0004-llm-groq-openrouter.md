# ADR 0004 — Sugerencia de triage con LLM vía Groq (principal) y OpenRouter (respaldo)

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
La sugerencia debe llegar en segundos, ser explicable y auditable, y no bloquear el flujo clínico si falla. No hay datos propios para entrenar un clasificador.

## Decisión
La IA es el **módulo `ai` dentro de NestJS**, con estos componentes:
- **Puerto `LlmClient`** con dos adaptadores con API compatible con OpenAI: `GroqAdapter` (principal) y `OpenRouterAdapter` (respaldo).
- **`TriagePromptBuilder`**: construye el prompt versionado (`ai/prompts/`, `prompt_version`).
- **`TriageResponseValidator`**: valida el JSON contra un esquema. Los factores de la explicación deben referirse a campos presentes en la entrada.
- **`SafetyGuards`**: reglas deterministas posteriores al LLM (ver ADR 0005).
- **`TriageAdvisor`**: orquesta el flujo. Usa `temperature = 0`, el modelo fijado por versión, timeout por llamada y **un único reintento**; si Groq falla, pasa a OpenRouter, y si todo falla, a **triage manual**.
- El payload al LLM **nunca** incluye nombre ni documento.
- Cada intento se persiste en `triage_suggestions` con el proveedor, el modelo, la versión del prompt, la respuesta cruda, los tokens, la latencia y el estado (`OK`, `INVALID_OUTPUT`, `TIMEOUT`, `FAILED`).
- Los cambios de prompt o de modelo se evalúan con las viñetas sintéticas (`npm run ai:eval`).

## Alternativas descartadas
- **Random Forest + Mistral** (planteamiento original de la definición): no hay datos para entrenar y suma un pipeline de ML que mantener. Se puede retomar cuando haya datos del piloto.
- **Microservicio de IA aparte (Python):** contradice el ADR 0001 y añade despliegue y contrato interno.
- **Un único proveedor:** sin respaldo, una caída deja el flujo sin sugerencia (aunque el triage manual siga funcionando).
- **SDK propietario de un proveedor:** la API compatible con OpenAI permite cambiar de proveedor con un adaptador mínimo.

## Consecuencias
- La IA es reemplazable y las pruebas del validador y de los guards no dependen del LLM.
- Hay costo por token y dependencia de terceros, mitigados con el fallback y el triage manual.
- **Preguntas abiertas:** modelo concreto en cada proveedor y timeout (PA-F04-2 y PA-F04-3).
