# ADR 0010 — LLM local en el móvil para la entrevista de síntomas

- **Estado:** Aceptada (F-11, humano, 2026-11-18)
- **Fecha:** 2026-11-18

## Contexto
F-11 quiere que el paciente responda preguntas de seguimiento sobre sus síntomas antes de enviar el prerregistro, sin que sus datos salgan del teléfono. La comparativa de runtimes y modelos está en `docs/research/llm-on-device-android.md`.

## Decisión
- **Runtime:** LiteRT-LM (`com.google.ai.edge.litertlm:litertlm-android`), con la versión fijada.
- **Modelo:** Gemma 4 E2B-it en formato `.litertlm` (Apache 2.0). La URL y el SHA-256 se fijan en el build.
- **Distribución:** el modelo **no va en el APK**. Se descarga como opción, solo por Wi-Fi, de forma reanudable y verificada.
- **Equipos que no pueden correrlo:** si el teléfono tiene menos de 6 GB, si el modelo no está o si falla al cargar, la entrevista la genera el **backend** con el LLM de ADR 0004. Va con aviso previo, se aplica `redact()` y no se persiste nada (decisión del humano, 2026-11-18).
- **El modelo solo pregunta.** La seguridad no depende del prompt: hay un validador de salida y reglas de señales de alarma **deterministas en código**, iguales en Kotlin y en TS, con un fixture compartido.
- **No reemplaza ni debilita la IA de triage del backend** (ADR 0004) ni las SafetyGuards (ADR 0005). La entrevista es una entrada más, marcada como no verificada.

## Alternativas descartadas
- **Gemini Nano (AICore):** solo corre en equipos de gama alta que casi no hay en Colombia.
- **MediaPipe LLM Inference:** en modo solo mantenimiento.
- **llama.cpp:** queda como alternativa si LiteRT-LM falla, a costa de mantener el JNI y el NDK.
- **Llama 3.2:** su política de uso restringe la práctica en salud.
- **Modelo dentro del APK:** pesa 2,6 GB y no todos los equipos pueden usarlo.

## Consecuencias
- Hay dos motores con el mismo esquema de salida, y las reglas de seguridad quedan duplicadas en Kotlin y TS. Se mitiga con el fixture compartido.
- En el fallback, los datos salen del teléfono antes del envío final. Es una excepción explícita, con aviso al paciente, a la intención de privacidad de F-11.
- La latencia depende del equipo. Los objetivos se miden en un teléfono de gama media real.
