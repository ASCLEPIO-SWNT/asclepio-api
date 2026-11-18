# Investigación: LLM local en Android para la entrevista de síntomas (F-11)

- **Fecha:** 2026-11-18
- **Alcance:** cómo correr un LLM pequeño (menos de ~4B parámetros) de forma nativa en la app del paciente (Kotlin, Compose, minSdk 31, targetSdk 37). El modelo debe hacer preguntas de seguimiento en español y devolver JSON que cumpla un esquema. Se descarga después de instalar la app.
- **Método:** fuentes oficiales (documentación de Google AI Edge, ML Kit, repos de GitHub, model cards de Hugging Face). Lo que no se pudo comprobar dice **no verificado**. Las cifras de rendimiento son las publicadas por el fabricante o por terceros; **no se han medido en un equipo propio**.

## 1. Runtimes

| Runtime | Estado y API Kotlin | JSON con esquema / function calling | Descarga del modelo después de instalar | Veredicto |
|---|---|---|---|---|
| **LiteRT-LM** (Google AI Edge) | API Kotlin marcada como *Stable*. Artefacto `com.google.ai.edge.litertlm:litertlm-android`, clases `Engine` y `Conversation`. Backends CPU, GPU y NPU [1][2]. Release v0.19.1 del 2026-11-05 [3]. Licencia Apache-2.0 [4]. | **Sí.** `ConversationConfig(enableResponseFormat = true)` con `ResponseFormat.json(schema)` o `.regex(...)` [5]. La v0.19.0 añade "Accelerated Logit Masking" en GPU [3]. Function calling con `@Tool` [2]. | Sí: `EngineConfig(modelPath = …/model.litertlm)` [2] | **Recomendado** |
| **MediaPipe LLM Inference** | Solo mantenimiento y deprecado en Android/iOS, con migración recomendada a LiteRT-LM [6][7]. La URL de la guía Android ya muestra contenido de LiteRT-LM [8]. | No encontrado | Sí (`.task`) | Descartado para código nuevo |
| **llama.cpp** (`examples/llama.android`) | Binding Kotlin de ejemplo (`InferenceEngine`, `Flow`). Solo CPU, hasta SME2 [9]. Sin AAR oficial publicado (no verificado). | Gramáticas GBNF y conversión de JSON Schema en el núcleo. No soporta `$ref` anidados, `if/then`, `patternProperties`, entre otros [10]. Que el binding Android las exponga está **no verificado**: probablemente toca extender el JNI. | Sí (GGUF) | **Alternativa**. Más trabajo nativo con el NDK. |
| **ExecuTorch** | `LlmModule` en el AAR `executorch-android`, marcado *experimental and subject to change* [11] | No documentado [11] | Sí (`.pte`) | No |
| **MLC LLM** | Binding Java. Modelos compilados por GPU. Se reportan congelamientos de 20 a 50 s en algunos Adreno. No corre en emulador [12]. | No en la guía Android (no verificado) | Sí, desde HF [12] | No |
| **Gemini Nano** (ML Kit GenAI Prompt API, sobre AICore) | Beta, sin SLA [13][14]. Solo en primer plano, con cuota por app y de batería [15]. Cualquier app puede usarlo desde ML Kit. | La doc habla de "typed structured output" [14]; el JSON Schema está no verificado | No aplica: el modelo lo gestiona AICore | **No sirve como base.** Solo Pixel 9/10/11, Galaxy S25/S26/Z y algunos Xiaomi 15/17, POCO y realme GT [15][16]. **No** Galaxy A, Moto G ni Redmi Note. Español: "may vary depending on the device" [15]. |

## 2. Modelos (menos de ~4B)

Salvo que se indique otra fuente, las cifras son de la model card oficial de LiteRT-LM (1.024 tokens de prefill y 256 de decode). Las cifras de memoria son de la ficha y no se midieron en dispositivos de gama media.

| Modelo | Licencia | Descarga en formato del runtime | Rendimiento publicado (decode / TTFT / memoria) | Español | Salida estructurada | Integración Kotlin |
|---|---|---|---|---|---|---|
| **Gemma 4 E2B-it** (2,3B efectivos) [17] | **Apache 2.0** desde el 2026-04-02 [18] | `.litertlm` de **2.583 MB** (pesos de 2, 4 y 8 bits) [19] | S26 Ultra GPU: 52 tok/s, 0,3 s, 676 MB. CPU: 47 tok/s, 1,8 s, 1.733 MB [19]. Dimensity 7300: ~10 tok/s y primera palabra en 2,2 s (tercero, runtime no verificado) [20]. | Más de 35 idiomas, MMMLU 67,4 % [17] | Tool use nativo [17], más `ResponseFormat` del runtime | Directa con LiteRT-LM |
| Gemma 4 E4B-it | Apache 2.0 [21] | 3,66 GB [21] | S26 Ultra GPU: 22 tok/s. CPU: 17,7 tok/s, 5,3 s, 3.283 MB [21] | MMMLU 76,6 % [17] | Igual | Directa, pero demasiado pesado para gama media |
| Gemma 3n E2B | Gemma Terms + Prohibited Use Policy [22] | No verificado | S24 Ultra CPU: 16,1 tok/s [22] | Más de 140 idiomas | Limitada | Directa. Superado por Gemma 4. |
| Gemma 3 1B | Gemma Terms [23] | int4 (no verificado) | S24 Ultra CPU: 55 tok/s [23] | No verificado (probablemente pobre en lo clínico) | Limitada | Directa |
| Qwen3-0.6B | Apache 2.0 [24] | `.litertlm` int4 de 328 MiB [24] | Galaxy S26 GPU: 81 tok/s, ~2 GB de pico [24] | Básico | Tool calling | Directa. Demasiado pequeño para diálogo clínico. |
| Qwen3.5 2B | Apache 2.0 [25] | GGUF [26]. `.litertlm` no verificado | No verificado | 201 idiomas | Tool calling | Vía llama.cpp. La ficha lo orienta a prototipado [25]. |
| Phi-4-mini (3,8B) | MIT [27] | Listado en LiteRT-LM [1]; tamaño no verificado | No verificado | Uno de 23 idiomas | Function calling | Pesado para gama media |
| Llama 3.2 1B/3B | Community License; su AUP prohíbe la "unlicensed practice of … medical/health" [28] | GGUF | No verificado | Soportado | Sí | Vía llama.cpp. **Zona gris legal**: descartado. |

**Licencias en salud:** Gemma 4 (Apache 2.0), Qwen (Apache 2.0) y Phi (MIT) son permisivas. Gemma 3/3n y Llama traen políticas de uso que tocan la salud. Antes de distribuir hay que revisar el archivo LICENSE del repositorio exacto del modelo.

**Español colombiano:** no hay benchmarks públicos (no verificado). Se evalúa con las viñetas propias (F-11, D11).

## 3. Parque de teléfonos en Colombia

- **Envíos 2T-2026 (Omdia, vía TelecomLead):** Xiaomi 27 %, Samsung 22 %, Motorola 15 %, OPPO 11 %, Transsion 10 % [29]. Equipos de referencia:
  - Redmi Note 15 4G: 6/128 GB a ~COP 700k y 8/256 GB a ~COP 850k.
  - Galaxy A17 y Moto G17/G67/G77.
- **Tendencia:** los envíos de LATAM cayeron 10 % interanual en el 2T-2026 por la escasez de memoria [31], lo que presiona a la baja la RAM de los equipos nuevos.
- **Distribución de RAM:** ningún informe público la da para Colombia (no verificado). **Estimación propia, no un dato.** Supuestos:
  - la base instalada tiene unos 3 años;
  - la gama de entrada es el 40–50 % y trae 4 GB o menos;
  - la gama media es el 35–40 % y trae 6–8 GB;
  - la gama alta es el 10–15 % y trae 8 GB o más.

  Con eso: **~45–55 % de los Android activos tendrían 6 GB o más, y ~25–35 % tendrían 8 GB o más.**

  Gemma 4 E2B (~2,6 GB en disco, 0,7–1,7 GB de trabajo [19]) es viable desde 6 GB. Por eso el umbral de F-11 es `totalMem ≥ 5,5 GB`, que es lo que reportan los equipos de 6 GB.

## 4. Recomendación

**Principal: LiteRT-LM + Gemma 4 E2B-it (`.litertlm`).**
- Es el runtime que Google mantiene y el sucesor de MediaPipe, con API Kotlin estable.
- Ofrece decodificación restringida por JSON Schema.
- La licencia es Apache 2.0, sin una política de uso que choque con el caso clínico.
- Carga el modelo desde una ruta en disco, así que encaja con la descarga después de instalar.
- Latencia esperada por turno en gama media: con preguntas cortas (~40 tokens) en GPU, **2–6 s** (estimación).

**Alternativa: llama.cpp (GGUF Q4) + Qwen3.5-2B o Gemma 4 E2B, con gramática GBNF generada desde el JSON Schema.**
- Es el ecosistema de gramáticas más maduro.
- A cambio, obliga a mantener el JNI y el NDK, solo usa CPU y no tiene NPU.

**Dispositivos que no pueden correrlo:** fallback al LLM del backend (decisión del humano del 2026-11-18, F-11 D5).

## 5. Advertencias
1. `ResponseFormat.json` en Kotlin es de noviembre de 2026 [5]: hay que fijar una versión exacta y probarla en un equipo real.
2. No hay benchmarks oficiales en Snapdragon 6/7 ni en Helio. Hay que medir en un Redmi Note 15 o un Galaxy A antes de dar por buenos los objetivos de latencia.
3. Una descarga de 2,6 GB pesa en planes prepago: solo por Wi-Fi, con checksum y reanudable.
4. Un JSON válido no implica contenido clínico seguro. Por eso hay un validador y reglas de alarma deterministas en código (F-11 D4).

## Fuentes
1. https://developers.google.com/edge/litert-lm/overview
2. https://developers.google.com/edge/litert-lm/android
3. https://github.com/google-ai-edge/LiteRT-LM/releases
4. https://github.com/google-ai-edge/LiteRT-LM
5. https://github.com/google-ai-edge/LiteRT-LM/issues/1662
6. https://github.com/google-ai-edge/litert-samples/pull/471
7. https://dev.to/charleshartmann/mediapipe-llm-inference-is-maintenance-only-start-on-litert-lm-and-add-this-abi-check-48h2
8. https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android
9. https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md
10. https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md
11. https://docs.pytorch.org/executorch/stable/llm/run-on-android.html
12. https://llm.mlc.ai/docs/deploy/android.html
13. https://developer.android.com/blog/posts/ml-kit-s-prompt-api-unlock-custom-on-device-gemini-nano-experiences
14. https://developers.google.com/ml-kit/genai/prompt/android
15. https://developers.google.com/ml-kit/genai
16. https://censuus.com/blog/for-developers/gemini-nano-android-prompt-api-supported-devices
17. https://huggingface.co/google/gemma-4-E2B-it
18. https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
19. https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
20. https://askloci.ai/speed/dimensity-7300/gemma-4-e2b/
21. https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm
22. https://huggingface.co/google/gemma-3n-E2B-it-litert-lm
23. https://huggingface.co/litert-community/Gemma3-1B-IT
24. https://huggingface.co/litert-community/Qwen3-0.6B
25. https://huggingface.co/Qwen/Qwen3.5-2B
26. https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF
27. https://huggingface.co/microsoft/Phi-4-mini-instruct
28. https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct
29. https://telecomlead.com/smart-phone/colombia-smartphone-market-q2-2026-xiaomi-leads-samsung-as-claro-and-tigo-movistar-reshape-mobile-competition-127570
30. https://gs.statcounter.com/vendor-market-share/mobile/colombia
31. https://counterpointresearch.com/en/insights/samsung-apple-growth-latam-market-q2-2026
