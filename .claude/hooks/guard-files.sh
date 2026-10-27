#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit) — asclepio-api: migraciones versionadas inmutables y .env intocable.
f=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[[ -n "$f" ]] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
base=$(basename "$f")
if [[ "$base" == .env || "$base" == .env.* ]] && [[ "$base" != .env.example ]]; then
  echo "BLOQUEADO por el harness: no se edita '$base' (secretos). Edita .env.example y que el humano actualice su .env." >&2
  exit 2
fi
# Una migración ya versionada en git puede estar aplicada en la base compartida: es inmutable.
# Una recién creada con `prisma migrate dev --create-only` (aún sin trackear) sí se puede rellenar o editar.
# ponytail: "versionada" = trackeada por git; si una migración sin commit llegara a aplicarse en Supabase, este hook no lo detecta.
if [[ "$f" == */prisma/migrations/* && -e "$f" ]] && git -C "$root" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
  echo "BLOQUEADO por el harness (ADR 0003): '$f' ya está versionada en git y es inmutable. Crea una migración nueva con 'prisma migrate dev --create-only'." >&2
  exit 2
fi
exit 0
