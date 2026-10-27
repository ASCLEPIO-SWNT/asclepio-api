# ADR 0008 — La app móvil es del paciente (pre-registro); recepción confirma en la web

- **Estado:** Aceptada (humano, 2026-10-26). **Modifica** la decisión de arquitectura nº 8 (alcance del móvil: admisión por recepción) y el ADR 0006 en cuanto a quién dicta.
- **Fecha:** 2026-10-26

## Contexto
Originalmente la app móvil era la herramienta de **recepción** para registrar pacientes. El equipo decidió que el móvil sea la app del **paciente** que llega a urgencias, para que llene sus propios datos y su motivo de consulta y descargue así a recepción.

## Decisión
1. **Dispositivo:** el **teléfono del propio paciente**.
2. **Identidad:** el paciente tiene una **cuenta de paciente con login** (credenciales propias). Las cuentas de paciente **no son `users`** del personal ni tienen roles de staff: son un tipo de principal distinto, con permisos mínimos (solo sobre sus propios datos y pre-registros).
3. **Flujo:**
   1. El paciente inicia sesión en la app, completa o actualiza sus datos, escribe o **dicta** el motivo de consulta (en el dispositivo, ADR 0006) y envía un **pre-registro** para una sede.
   2. **Recepción (`RECEPTION`) confirma en la web**: verifica la identidad del paciente presente y convierte el pre-registro en una atención. También puede registrar directamente en la web a quien no use la app (paciente grave, NN o sin teléfono).
4. **Hora legal de llegada (Res. 373):** `arrival_at` es la **hora del servidor en el momento en que recepción confirma**. La hora del pre-registro se guarda solo como referencia (`pre_registered_at`) y no se usa en los indicadores legales.
5. El pre-registro **no** entra en la cola de triage hasta que recepción lo confirma.

## Alternativas descartadas
- **Kiosco o tablet de la IPS:** se descartó por decisión del equipo (el paciente usa su propio teléfono).
- **Paciente sin login (solo datos):** se descartó; el equipo quiere una cuenta de paciente.
- **Llegada legal = hora del autorregistro:** se descartó, porque el paciente podría pre-registrarse desde casa y falsear el tiempo de espera.
- **Eliminar recepción:** se descartó; recepción sigue siendo necesaria para la verificación de identidad y para los pacientes que no usan la app.

## Consecuencias
- **Nuevo principal "paciente"** en `auth`, separado del personal: tokens distintos (audiencia o claims distintos) y guards que impiden que un token de paciente acceda a endpoints de staff y viceversa.
- **Modelo de datos:** cuentas de paciente vinculadas a `patients` y una entidad o estado de **pre-registro**. Se cierra en la spec de F-01-api/F-02-api (ver `docs/data-model.md`).
- **Web:** F-02-web pasa de solo consulta a incluir la **bandeja de pre-registros** y la **confirmación por recepción** (y el registro directo).
- **Privacidad:** el paciente introduce sus propios datos personales. Hace falta consentimiento de tratamiento de datos (Ley 1581 de 2012) y la UI no debe permitir ver datos de otros pacientes.
- **Superficie de abuso:** la app es pública, así que los endpoints de paciente necesitan rate limiting y validación estricta. Los pre-registros sin confirmar expiran.
- El dictado sigue siendo en el dispositivo y ahora lo hace el paciente: el audio sigue sin salir del teléfono.

## Preguntas resueltas (humano, 2026-10-26)
- [x] **PA-PAC-1** Alta e inicio de sesión → **documento (tipo + número) + contraseña**, con la misma política que el personal: mínimo 10 caracteres y bloqueo de 15 min tras 5 intentos. Sin OTP en el MVP.
- [x] **PA-PAC-2** Sede del pre-registro → el paciente la **elige de una lista** de las sedes del tenant.
- [x] **PA-PAC-3** Expiración → un pre-registro `PENDING` sin confirmar **expira a las 6 h** (`EXPIRED`).
- [x] **PA-PAC-4** Qué ve el paciente → **solo el estado** de su pre-registro o atención ("pendiente de confirmación", "en espera de triage", "en atención", "cerrada"). **No ve su nivel de triage.**
- [x] **PA-PAC-5** Consentimiento → **casilla obligatoria** con un texto de tratamiento de datos (Ley 1581 de 2012) que redacta el equipo. Se guarda `consent_at` y la versión del texto. Sin aceptarlo no se crea la cuenta.
- [x] **PA-PAC-6** Menores → **no tienen cuenta en el MVP**. A los menores los registra recepción directamente en la web.
