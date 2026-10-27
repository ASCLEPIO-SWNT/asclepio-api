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

## Preguntas abiertas (nuevas)
- **PA-PAC-1** Método de alta e inicio de sesión del paciente: documento + contraseña (propuesta, sin infraestructura extra) u OTP por SMS o correo (requiere proveedor).
- **PA-PAC-2** ¿Cómo elige el paciente la sede del pre-registro (lista o QR en la entrada)?
- **PA-PAC-3** ¿Cuánto tiempo vive un pre-registro sin confirmar antes de expirar?
- **PA-PAC-4** ¿Qué ve el paciente después de que lo confirman (estado de su atención, turno)? ¿Ve su nivel de triage?
- **PA-PAC-5** Texto y registro del consentimiento de tratamiento de datos (Ley 1581).
- **PA-PAC-6** Menores de edad: ¿pueden tener cuenta? ¿Un acudiente registra por ellos?
