# F-11-api — reabierta por enmienda

- **2026-11-18:** el humano ejecutó `npm run ai:eval`. Triage: 19/20 aciertos y 0 % de subclasificación. Entrevista: 100 % de JSON válido y 100 % de alarmas escaladas, pero siempre termina en 3 preguntas (faltó `ONSET` o `LOCATION` en IV-001, IV-002 e IV-006) y escala ambiguos (IV-009 "me caí" en el turno 0, IV-008).
- **Enmienda aprobada por el humano en el chat** («aplica las propuestas 1 y 2 antes del push»): R13 enmienda 2, R14 enmienda y R18 nuevo (prompt `interview-v2`). Tarea T12.
- Tras implementarla y revisarla, el humano vuelve a ejecutar `ai:eval` para confirmar.
