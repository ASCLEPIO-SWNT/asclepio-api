# Viñetas clínicas de evaluación

Casos **sintéticos** con el nivel esperado, que se usan para evaluar el prompt y el modelo del módulo `ai` con `npm run ai:eval` (ver `docs/verification.md`).

> Hay 20 viñetas (`V-001`…`V-020`, 4 por nivel I–V) en **borrador** (`"source": "BORRADOR — revisar con asesor clínico"`, `reviewed_by: null`), redactadas en F-04-api (PA-F04-6). Mientras ninguna esté revisada, el umbral de `ai:eval` no es vinculante.

## Reglas
- Solo datos **sintéticos**: sin nombres ni documentos, ni siquiera ficticios (el payload al LLM nunca los lleva).
- Hay un archivo JSON por viñeta: `ai/vignettes/<id>.json`, con `id` en el formato `V-<nnn>`.
- Cada viñeta tiene que ser revisada por una persona del equipo y, cuando exista, por el asesor clínico.
- `ai:eval` **llama al LLM real** (consume tokens): nunca se ejecuta en `init.sh` ni en las pruebas unitarias.

## Formato

```json
{
  "id": "V-001",
  "title": "Dolor torácico con taquicardia (caso 7:42 p. m.)",
  "input": {
    "age_years": 58,
    "sex": "M",
    "chief_complaint_text": "dolor torácico opresivo de 40 minutos de evolución",
    "vital_signs": { "heart_rate": 112, "systolic_bp": 150, "diastolic_bp": 95, "spo2": 94 },
    "symptom_findings": []
  },
  "expected": {
    "level": 2,
    "acceptable_levels": [1, 2],
    "must_mention_factors": ["chief_complaint_text", "vital_signs.heart_rate"]
  },
  "source": "Definición del producto, caso de ejemplo",
  "reviewed_by": null
}
```

- `input` usa **los mismos nombres de campo que el `input_snapshot`** del módulo `ai` (D7 de specs/F-04-api/design.md): `age_years`, `sex` (`M`/`F`/`X`), `chief_complaint_text`, `complaint_source` (`TYPED`/`VOICE_ON_DEVICE`), `vital_signs` (`respiratory_rate`, `spo2`, `supplemental_oxygen`, `systolic_bp`, `diastolic_bp`, `heart_rate`, `consciousness` ACVPU, `temperature_c`, `glucose_mg_dl`) y `symptom_findings` (`[{ kind, description }]`). Lo que falte se completa con `null` (`complaint_source` con `TYPED` y `symptom_findings` con `[]`); un signo NEWS2 ausente no puntúa en los SafetyGuards.
- `expected.level` es el nivel esperado (1 = I). El umbral de PA-F04-6 mira solo las viñetas **revisadas** de nivel 1–2.
- `acceptable_levels` permite la sobreclasificación tolerable; la subclasificación cuenta siempre como fallo.
- `must_mention_factors` son los campos de entrada que la explicación debe citar.

## Salida esperada de `ai:eval`
Para cada viñeta: el nivel obtenido, si acertó, si subclasificó, si se aplicó algún guard, el proveedor, el modelo, `prompt_version` y la latencia. Además, un resumen con el porcentaje de acierto y de subclasificación.
