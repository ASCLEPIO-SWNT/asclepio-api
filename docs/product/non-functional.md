# Requisitos no funcionales

Cada spec que los afecte debe citarlos por su número (`RNF-xx`). Lo que no esté definido se marca como pregunta abierta y no se inventa.

| ID | Categoría | Requisito |
|---|---|---|
| RNF-01 | Auditoría | Toda acción que cree o cambie datos clínicos o de usuarios deja un registro en `audit_log` con el actor, la acción, la entidad y la hora del servidor. |
| RNF-02 | Inmutabilidad | `audit_log` y `encounter_events` solo admiten inserciones. El rol de base de datos `asclepio_app` no tiene `UPDATE` ni `DELETE` sobre ellas. `vital_signs` solo se inserta desde la aplicación. |
| RNF-03 | Decisión humana | Ninguna atención tiene `final_level` sin una fila en `triage_decisions` (`VALIDATE`, `CORRECT` con motivo o `MANUAL`). |
| RNF-04 | Privacidad (LLM) | El payload que se envía al LLM no contiene nombre, documento ni identificadores directos del paciente. Hay una prueba automática que lo verifica. |
| RNF-05 | Privacidad (logs) | Los logs son estructurados (JSON) y no contienen datos personales: nombres, documentos ni texto libre clínico. |
| RNF-06 | Privacidad (voz) | El audio nunca sale del dispositivo; la API solo recibe texto. |
| RNF-07 | Latencia IA | Cada llamada al LLM tiene timeout y hay un único reintento. **Pregunta abierta:** el valor exacto del timeout y el presupuesto total de latencia (la definición dice "en segundos"). |
| RNF-08 | Disponibilidad con fallback | Si Groq falla, se usa OpenRouter. Si ambos fallan o la salida es inválida, el flujo continúa como triage manual sin bloquear a enfermería. |
| RNF-09 | Determinismo | `temperature = 0`; modelo fijado por versión; prompt versionado (`prompt_version`). Cada sugerencia guarda el proveedor, el modelo, la versión del prompt, los tokens y la latencia. |
| RNF-10 | Tiempo | Las horas legales (llegada, triage, decisión) se toman del reloj del servidor. Se guardan como `timestamptz` en UTC y se muestran en `America/Bogota`. El cliente nunca envía horas legales. |
| RNF-11 | Multi-tenant | Todo acceso a datos se filtra por el tenant del usuario autenticado. Un usuario no puede ver datos de otro tenant. |
| RNF-12 | Autorización | Cada endpoint declara los roles que permite (`RECEPTION`, `NURSE`, `PHYSICIAN`, `ADMIN`). El acceso se deniega por defecto. |
| RNF-13 | Responsive | La web funciona en escritorio y tablet. El móvil se adapta a teléfono y tablet (`WindowSizeClass`). |
| RNF-14 | Contrato | La API publica OpenAPI versionado con semver. Los errores siguen `application/problem+json` y todas las rutas cuelgan de `/api/v1`. |
| RNF-15 | Datos sintéticos | En el MVP solo hay datos sintéticos. Los datos de desarrollo en la base compartida llevan el prefijo `DEV-<nombre>-`. |
| RNF-16 | Base compartida | Los cambios de esquema se hacen solo con Prisma Migrate y en la base compartida solo se ejecuta `migrate deploy`. No se usan `migrate reset`, `migrate dev` (contra la compartida) ni `db push`. |
| RNF-17 | Accesibilidad / UX clínica | En la UI, "Corregir" tiene el mismo peso visual que "Validar". La sugerencia nunca se presenta como decisión tomada. |
| RNF-18 | Seguridad de secretos | No hay secretos en el repo; solo `.env.example` con valores ficticios. |
