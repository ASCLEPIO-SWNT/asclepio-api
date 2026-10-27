# Visión del producto — Asclepio

> **Triage de urgencias asistido por IA para IPS y hospitales de Colombia.**
> *La IA propone, el profesional decide.*

Resumen de `asclepio-definicion-proyecto.md` (proyecto del curso SWNT 2026-2, Escuela Colombiana de Ingeniería Julio Garavito). La sección "Tecnología" se reescribió para reflejar las decisiones de arquitectura cerradas (ver `docs/adr/`).

## 1. Qué es

Plataforma SaaS de **apoyo a la decisión clínica** para el triage en urgencias. A partir de los signos vitales, los síntomas y el motivo de consulta (que puede dictarse por voz), sugiere el nivel de triage I–V (Resolución 5596 de 2015) con una justificación clínica visible. Enfermería **valida o corrige**: ninguna clasificación se asigna sin decisión humana.

Mientras se hace el triage, Asclepio registra los tiempos (llegada, clasificación, responsable), de modo que el reporte exigido por la **Resolución 373 de 2026** sale sin digitación adicional.

## 2. Problema

- La ocupación de urgencias de la red pública de Bogotá fue del 143 % en el 1T-2026 (el estándar es ≤ 95 %). Hay picos de 651 % (San Ignacio, abril de 2026).
- La Res. 5596 fija un tiempo máximo de 30 minutos para atender un Triage II, pero no existe un registro confiable para verificar si se cumple.
- El criterio de clasificación varía entre profesionales y entre turnos.
- Clasificar tarde o de forma inconsistente pone vidas en riesgo.

## 3. Por qué ahora

| Año | Hito | Implicación |
|---|---|---|
| 2015 | Res. 5596 | Escala I–V y registro obligatorio de la hora de clasificación. |
| 2022 | Auto 584, Corte Constitucional | Señala que no hay registro del tiempo entre la llegada y el triage. |
| Mar. 2026 | Res. 373 | Herramienta nacional de medición de tiempos de urgencias. |
| Nov. 2026 | Fase III Res. 373 | Reporte trimestral obligatorio a SISPRO, con alertas. |

## 4. Propuesta de valor

1. **Sugerencia en segundos**: nivel I–V con su justificación clínica visible.
2. **El mismo criterio en todos los turnos**: menos variación entre profesionales.
3. **Reporte Res. 373 sin digitar**: cada evento queda con hora y responsable.

### Escala de triage (Res. 5596)

| Nivel | Descripción |
|---|---|
| I | Riesgo vital |
| II | Puede deteriorarse rápido (atención ≤ 30 min) |
| III | Estable, requiere estudios |
| IV | Sin riesgo evidente |
| V | Sin deterioro |

**Principio rector:** la IA propone, el profesional decide. Sin la validación de enfermería no hay triage.

## 5. Flujo de un turno

1. **Paciente** (app móvil, en su teléfono) inicia sesión y envía un pre-registro con sus datos y su motivo, que puede dictar. **Recepción** (web) verifica su identidad y confirma la llegada; esa es la hora legal. También registra directamente a quien no use la app (ADR 0008).
2. **IA** sugiere el nivel I–V y explica por qué.
3. **Enfermería** (web) valida o corrige. La decisión final es suya.
4. **Médico y administración** (web) ven la cola priorizada y los reportes de tiempos y cumplimiento.

**Caso de ejemplo (7:42 p. m.):** hombre de 58 años con dolor torácico opresivo de 40 minutos; FC 112, PA 150/95, SatO₂ 94 %. La IA sugiere **Triage II** (dolor torácico más taquicardia: descartar síndrome coronario agudo) y enfermería valida o corrige. Registro: llegada 7:31, triage 7:42, validado por la enfermera jefe.

### Usuarios

| Rol (sistema) | Qué hace |
|---|---|
| Paciente (cuenta de paciente, app móvil) | Se pre-registra con sus datos y su motivo (escrito o dictado). |
| Recepción (`RECEPTION`) | Confirma los pre-registros y registra directamente a quien no use la app (web). |
| Enfermería de triage (`NURSE`) | Revisa la sugerencia; valida o corrige. |
| Médico de urgencias (`PHYSICIAN`) | Consulta la cola priorizada. |
| Administración (`ADMIN`) | Consulta tiempos y cumplimiento; exporta reportes. |

## 6. Tecnología (decisiones vigentes)

Arquitectura de **una sugerencia de IA, unas reglas deterministas de seguridad y una decisión humana**:

| Etapa | Componente | Entrada → salida | ADR |
|---|---|---|---|
| Voz a texto | `SpeechRecognizer` de Android **en el dispositivo**; el audio nunca sale del teléfono. Si no hay reconocimiento local, solo se admite texto. | audio → texto | 0006 |
| Sugerencia | Módulo `ai` del backend NestJS: un LLM vía **Groq** (principal) u **OpenRouter** (respaldo), con API compatible con OpenAI, `temperature = 0` y modelo fijado por versión. Devuelve JSON validado contra un esquema: nivel, explicación y factores. | signos + síntomas + motivo → nivel + justificación | 0004 |
| Reglas de seguridad | `SafetyGuards` deterministas que **solo pueden subir** la gravedad y siempre quedan registradas. | sugerencia → sugerencia ajustada | 0005 |
| Fallback | Si ambos proveedores fallan o la respuesta es inválida, se hace triage manual. | — | 0004 |
| Validación humana | Enfermería valida, corrige (con motivo) o clasifica manualmente. | sugerencia → decisión | — |
| Registro | Cada paso queda con hora del servidor y responsable (eventos append-only). | decisión → reporte | 0003 |

El payload que se envía al LLM **nunca** incluye nombre ni documento del paciente. Las correcciones de enfermería quedan registradas para auditar el modelo.

Stack: backend NestJS (monolito modular), PostgreSQL en Supabase con Prisma, web React + Vite (personal) y móvil Kotlin + Compose (paciente, ADR 0008). Todo corre en local; no hay despliegue por ahora (ADR 0001–0003, 0007).

## 7. Evidencia y medición

- Referencia externa: en Ivanov et al. (2021), KATE acertó el 75,7 % frente al 59,8 % de enfermería, y subclasificó el 9,7 % frente al 19,8 %. Los autores están vinculados al desarrollador.
- **No hay datos propios todavía y no se inventan.** El piloto de 90 días medirá: minutos de llegada a clasificación, concordancia IA ↔ enfermería (kappa), porcentaje de sub y sobreclasificación, y tiempo de digitación por turno.
- En el MVP **solo se usan datos sintéticos**.

## 8. Mercado, negocio y competencia (resumen)

- Entrada por las 84 IPS con urgencias de Bogotá. TAM ≈ $58.700 M COP/año, SAM ≈ $18.100 M, SOM $900 M (25 IPS en 3 años).
- Suscripción SaaS de $3.000.000 COP al mes por sede, más una implementación de pago único.
- El competidor real es el papel y el Excel. Las HCE registran el triage pero no ayudan a decidirlo.
- Diferencial: triage colombiano de punta a punta (Res. 5596, reporte Res. 373 y voz en español).

## 9. Equipo

Ignacio Andrés Castillo Rendón (producto), Marianella Polo Peña (UX/UI), Christian Alfonso Romero Martínez (arquitectura e IA), David Alejandro Patacón Henao (backend), Marlio José Charry Espitia (negocio).

## 10. Visión

> Que ningún paciente espere de más por un triage mal hecho. Y que la enfermera de las 7:42 ya no decida sola.
