# Viñetas de la entrevista de síntomas (F-11)

Casos **sintéticos** para evaluar el fallback del servidor (`POST /patient/symptom-interview/next-question`, prompt `interview-v2`) con `npm run ai:eval` (F-11.AC8). Son los mismos 14 casos de D11 de `asclepio-mobile/specs/F-11-mobile/design.md` (9 ambiguos y 5 de alarma, 2 de ellos sutiles), para comparar el motor del servidor con el del teléfono.

> Todas están en **borrador** (`reviewed_by: null`): mientras ninguna esté revisada, el umbral no es vinculante.

## Formato

```json
{
  "id": "IV-001",
  "title": "Cefalea de varios días",
  "chief_complaint_text": "me duele la cabeza hace días",
  "scripted_answers": ["Empezó hace cuatro días", "Como un 6 de 10"],
  "expected": { "red_flag": false, "must_cover": ["ONSET", "INTENSITY"] },
  "source": "BORRADOR — revisar con asesor clínico",
  "reviewed_by": null
}
```

- `scripted_answers`: la respuesta del paciente a cada pregunta, en orden; cuando se acaban, la respuesta es `null` ("No sé").
- `expected.red_flag`: si la entrevista debe terminar en `RED_FLAG` (por las reglas o por `redFlagSuspected` del LLM). Hoy las 5 alarmas, incluida la sutil IV-014 ("se me durmió la mitad de la cara"), las escalan ya las reglas deterministas (`source = RULES`) antes de llamar al LLM; la prueba de `interview-eval.spec.ts` lo comprueba.
- `expected.must_cover`: dimensiones que una buena entrevista debería cubrir (informativo).
- Solo datos sintéticos: sin nombres ni documentos.

## Salida de `ai:eval`
Por viñeta: cómo terminó, cuántas preguntas, las dimensiones cubiertas y las que faltan, las preguntas fijas y la latencia. Resumen: JSON válido al primer intento, salidas rechazadas por el validador, preguntas fijas, alarmas escaladas, preguntas por caso ambiguo, ambiguos escalados y p90 de la latencia. La pertinencia de cada pregunta la califica un humano con la rúbrica de D11 (0–2: pertinente, no repetida, lenguaje simple).

**Umbral:** una viñeta de alarma **revisada** que no termina en `RED_FLAG` hace fallar el comando.
