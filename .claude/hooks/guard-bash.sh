#!/usr/bin/env bash
# PreToolUse (Bash) — asclepio-api: protege la base compartida de Supabase (ADR 0003).
cmd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
block() { echo "BLOQUEADO por el harness (ADR 0003, base compartida): $1" >&2; exit 2; }
shopt -s nocasematch
re_reset='prisma[[:space:]]+migrate[[:space:]]+reset'
re_dev='prisma[[:space:]]+migrate[[:space:]]+dev'
re_push='prisma[[:space:]]+db[[:space:]]+push'
re_drop='(^|[^a-z_])drop[[:space:]]+(table|schema|database|index|view|materialized|role|user|type|function|column|constraint|trigger|policy|owned|sequence|extension)([^a-z_]|$)'
re_trunc='(^|[^a-z_])truncate[[:space:]]+(table[[:space:]]+)?(only[[:space:]]+)?["a-z_]'
re_del='delete[[:space:]]+from[[:space:]]+("?asclepio"?[[:space:]]*\.[[:space:]]*)?"?(audit_log|encounter_events)'
[[ "$cmd" =~ $re_reset ]] && block "'prisma migrate reset' está prohibido."
if [[ "$cmd" =~ $re_dev ]] && [[ "$cmd" != *--create-only* ]]; then
  block "'prisma migrate dev' solo se permite con --create-only. En la base compartida usa 'prisma migrate deploy' (lo decide el humano)."
fi
[[ "$cmd" =~ $re_push ]] && block "'prisma db push' está prohibido; usa migraciones."
[[ "$cmd" =~ $re_drop ]] && block "SQL con DROP está prohibido desde el agente."
[[ "$cmd" =~ $re_trunc ]] && block "SQL con TRUNCATE está prohibido desde el agente."
[[ "$cmd" =~ $re_del ]] && block "audit_log y encounter_events son append-only: DELETE prohibido."
exit 0
