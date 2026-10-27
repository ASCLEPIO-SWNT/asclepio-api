# Consentimiento de tratamiento de datos personales — app del paciente de Asclepio

> **Texto pendiente de redacción por el equipo. No válido legalmente.**

Este archivo es un marcador creado en F-01-api (R38, PA-8). El equipo debe sustituirlo por el texto real de
autorización de tratamiento de datos personales conforme a la Ley 1581 de 2012 y, al cambiarlo, subir la
versión vigente en la variable de entorno `PATIENT_CONSENT_VERSION` (valor inicial `2026-10-v1`).

La API lee este archivo una sola vez al arrancar (`PATIENT_CONSENT_TEXT_PATH`) y lo publica en
`GET /api/v1/public/consent` junto con la versión vigente.
