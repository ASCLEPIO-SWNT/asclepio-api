#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): formatea o corrige el lint SOLO del archivo tocado, si la herramienta ya está instalada.
# Nunca bloquea: si no hay herramienta o falla, sale con 0.
f=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[[ -n "$f" && -f "$f" ]] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
bin="$root/node_modules/.bin"
case "$f" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    [[ -x "$bin/prettier" ]] && "$bin/prettier" --write --log-level silent "$f" >/dev/null 2>&1
    [[ -x "$bin/eslint" ]] && "$bin/eslint" --fix "$f" >/dev/null 2>&1 ;;
  *.json|*.md|*.css|*.html|*.yml|*.yaml)
    [[ -x "$bin/prettier" ]] && "$bin/prettier" --write --log-level silent "$f" >/dev/null 2>&1 ;;
  *.kt|*.kts)
    command -v ktlint >/dev/null && ktlint -F "$f" >/dev/null 2>&1 ;;
esac
exit 0
