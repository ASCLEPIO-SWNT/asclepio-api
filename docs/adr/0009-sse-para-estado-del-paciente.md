# ADR 0009 — Server-Sent Events para el estado en vivo del paciente

- **Estado:** Aceptada (F-10, humano, 2026-11-18)
- **Fecha:** 2026-11-18

## Contexto
F-10 pide que el paciente vea su posición en la fila sin refrescar. Hasta ahora el sistema solo hace polling (la web cada 30 s, F-06), y la F-06 dejó los WebSockets fuera del alcance. El flujo es unidireccional: el servidor informa y el cliente solo escucha.

## Decisión
- Para el paciente, **SSE** (`text/event-stream`) con `@Sse()` de NestJS, sin dependencias nuevas en la API. En Android se usa `okhttp-sse`, de Square, en la misma versión que el OkHttp que ya usa la app.
- La autenticación es el mismo Bearer de paciente, en la cabecera.
- Hay un latido cada 15 s y el stream se cierra cuando vence el token. El cliente se reconecta con backoff.
- Los cambios se propagan con un bus en memoria (un `Subject` de rxjs) que publican las escrituras de `encounters`. El latido además recalcula, como red de seguridad.
- La web del personal **no cambia**: sigue con su polling de 30 s.

## Alternativas descartadas
- **Polling desde el móvil:** sin infraestructura nueva, pero no es en vivo (retraso de hasta un intervalo) y hace más peticiones.
- **WebSockets:** bidireccional sin necesidad, y requiere dependencia y adaptador nuevos.
- **Supabase Realtime:** el móvil hablaría con la base saltándose la API, con RLS y tokens de Supabase para pacientes. Rompe ADR 0003 y ADR 0008.

## Consecuencias
- **Techo conocido:** el bus en memoria funciona con **un solo proceso**. Con varias instancias, se pasa a `LISTEN/NOTIFY` de Postgres.
- Cada conexión abierta es una petición HTTP larga. Es aceptable para el volumen del MVP.
- El móvil solo se conecta con la pantalla visible: no hay servicio en segundo plano.
