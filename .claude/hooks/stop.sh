#!/usr/bin/env bash
# Stop: ejecuta ./init.sh --quick y muestra el resultado al usuario. Nunca bloquea (evita bucles).
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
out=$("$root/init.sh" --quick 2>&1)
summary=$(echo "$out" | grep -E '^\[(FAIL|WARN)\]|^FAIL:|^Estado:')
python3 -c 'import json,sys; print(json.dumps({"systemMessage": "init.sh --quick\n" + sys.argv[1]}))' "$summary"
exit 0
