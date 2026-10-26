# ADR 0006 — Transcripción de voz en el dispositivo Android

- **Estado:** Aceptada
- **Fecha:** 2026-10-26

## Contexto
Dictar el motivo de consulta ahorra tiempo a recepción. El audio de un paciente es un dato sensible y enviarlo a un servicio de ASR en la nube (por ejemplo, Whisper) aumenta la superficie de privacidad y el costo.

## Decisión
- La transcripción usa **`SpeechRecognizer` de Android en modo local**, comprobando en tiempo de ejecución que haya reconocimiento local en español disponible.
- Si no lo hay, la app ofrece **solo texto**.
- **El audio nunca sale del dispositivo.** La API recibe texto con `complaint_source = VOICE_ON_DEVICE`.
- El texto transcrito se puede editar antes de enviarlo.

## Alternativas descartadas
- **Whisper en la nube o en el servidor:** el audio saldría del dispositivo y tendría costo y latencia de subida.
- **Whisper on-device (whisper.cpp):** aumenta el tamaño de la app y la complejidad nativa para un MVP.
- **Dictado en la web (Web Speech API):** en Chrome envía el audio a servidores de Google, y la web no es el canal de admisión.

## Consecuencias
- La disponibilidad depende del dispositivo y de la versión de Android (el `minSdk` se documenta en un ADR del repo móvil).
- La API no maneja audio.
