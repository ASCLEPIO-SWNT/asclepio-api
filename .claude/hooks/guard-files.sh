#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit) — asclepio-api: migraciones existentes inmutables y .env intocable.
f=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[[ -n "$f" ]] || exit 0
base=$(basename "$f")
if [[ "$base" == .env || "$base" == .env.* ]] && [[ "$base" != .env.example ]]; then
  echo "BLOQUEADO por el harness: no se edita '$base' (secretos). Edita .env.example y que el humano actualice su .env." >&2
  exit 2
fi
if [[ "$f" == */prisma/migrations/* && -e "$f" ]]; then
  echo "BLOQUEADO por el harness (ADR 0003): las migraciones existentes son inmutables. Crea una nueva con 'prisma migrate dev --create-only'." >&2
  exit 2
fi
exit 0
