#!/usr/bin/env bash
# init.sh — verificación del harness SDD de Asclepio.
# Mismo script en asclepio-api, asclepio-web y asclepio-mobile; detecta el repo por feature_list.json.
# Uso: ./init.sh [--quick]   (--quick omite las pruebas y la calidad)
# Nunca ejecuta viñetas del LLM (ai:eval) ni comandos que escriban en la base de datos.
set -uo pipefail
cd "$(dirname "$0")"

QUICK=0
[[ "${1:-}" == "--quick" ]] && QUICK=1
FAILS=0; WARNS=0
ok()   { echo "[OK]   $*"; }
warn() { echo "[WARN] $*"; WARNS=$((WARNS + 1)); }
fail() { echo "[FAIL] $*"; FAILS=$((FAILS + 1)); }
section() { echo; echo "== $* =="; }

REPO=$(grep -o '"project": *"asclepio-[a-z]*"' feature_list.json 2>/dev/null | sed 's/.*asclepio-\([a-z]*\)"/\1/')
if [[ -z "$REPO" ]]; then
  echo "[FAIL] feature_list.json ausente o sin campo project"; exit 1
fi
echo "Asclepio init — repo: $REPO$([[ $QUICK == 1 ]] && echo ' (quick)')"

# ---------------------------------------------------------------- 1. Entorno
section "1. Entorno"
if [[ "$REPO" == "mobile" ]]; then
  if command -v java >/dev/null; then
    JV=$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')
    [[ "$JV" =~ ^[0-9]+$ && "$JV" -ge 17 ]] && ok "JDK $JV" || fail "Se requiere JDK 17+ (encontrado: $JV)"
  else
    fail "java no encontrado (se requiere JDK 17+)"
  fi
  [[ -x ./gradlew ]] && ok "Gradle wrapper presente" || warn "Gradle wrapper ausente (llega con F-00-mobile)"
else
  if command -v node >/dev/null; then
    NV=$(node -p 'process.versions.node.split(".")[0]')
    [[ "$NV" -ge 20 ]] && ok "Node $(node -v)" || fail "Se requiere Node >= 20 (encontrado: $(node -v))"
  else
    fail "node no encontrado (se requiere Node >= 20)"
  fi
  command -v npm >/dev/null && ok "npm $(npm -v)" || fail "npm no encontrado"
fi

# ---------------------------------------------------------------- 2. Harness
section "2. Archivos del harness"
REQ=(README.md CLAUDE.md AGENTS.md CHECKPOINTS.md feature_list.json init.sh .gitignore .env.example
     progress/history.md docs/architecture.md docs/conventions.md docs/specs.md docs/verification.md
     .claude/settings.json .claude/agents/leader.md .claude/agents/spec_author.md
     .claude/agents/implementer.md .claude/agents/reviewer.md)
[[ "$REPO" == "api" ]] && REQ+=(docs/product/vision.md docs/product/glossary.md docs/product/non-functional.md
     docs/roadmap.md docs/data-model.md ai/vignettes/README.md)
MISSING=()
for f in "${REQ[@]}"; do [[ -e "$f" ]] || MISSING+=("$f"); done
[[ -d progress/current ]] || MISSING+=("progress/current/")
[[ -d specs ]] || MISSING+=("specs/")
if [[ "$REPO" == "api" ]]; then
  ls docs/product/features/F-0*.md >/dev/null 2>&1 || MISSING+=("docs/product/features/")
  ls docs/adr/0*.md >/dev/null 2>&1 || MISSING+=("docs/adr/")
fi
((${#MISSING[@]})) && fail "Faltan: ${MISSING[*]}" || ok "Archivos base presentes"
[[ -x init.sh ]] && ok "init.sh ejecutable" || fail "init.sh no es ejecutable (chmod +x init.sh)"
if [[ "$REPO" != "api" ]]; then
  [[ -d ../asclepio-api/openapi ]] && ok "../asclepio-api/openapi presente" \
    || warn "../asclepio-api/openapi no existe: clona asclepio-api junto a este repo"
fi

# ---------------------------------------------------------------- 3 y 4. Estado (feature_list.json)
# Se valida con python3 (o node si no hay python3). Imprime líneas [OK]/[WARN]/[FAIL]; la primera es F00=<status>.
read -r -d '' PY <<'PYEOF'
import json, os, sys
fl = json.load(open("feature_list.json"))
feats = fl["features"]; valid = set(fl["rules"]["valid_status"])
by_id = {f["id"]: f for f in feats}
api_path = "../asclepio-api/feature_list.json"
api = {f["id"]: f for f in json.load(open(api_path))["features"]} if os.path.exists(api_path) else None
f00 = next((f["status"] for f in feats if f["global_id"] == "F-00"), "pending")
print("F00=" + f00)
snap = "../asclepio-api/openapi/asclepio-api.v1.json" if fl["project"] != "asclepio-api" else "openapi/asclepio-api.v1.json"
snap_ver = json.load(open(snap)).get("info", {}).get("version") if os.path.exists(snap) else None
errs = 0
def bad(m):
    global errs; errs += 1; print("[FAIL] " + m)
for f in feats:
    i, s = f["id"], f["status"]
    if s not in valid: bad(f"{i}: estado inválido '{s}'")
    if s == "in_progress" and not os.path.exists(f"progress/current/{i}.md"):
        bad(f"{i}: in_progress sin progress/current/{i}.md")
    if f.get("sdd") and s in ("spec_ready", "in_progress", "done"):
        miss = [n for n in ("requirements.md", "design.md", "tasks.md") if not os.path.exists(f"specs/{i}/{n}")]
        if miss: bad(f"{i}: sdd en '{s}' sin specs/{i}/{', '.join(miss)}")
    if s == "in_progress":
        for d in f["depends_on"]:
            if d in by_id: ds = by_id[d]["status"]
            elif d.endswith("-api") and api is not None: ds = api.get(d, {}).get("status", "desconocida")
            elif d.endswith("-api"):
                print(f"[WARN] {i}: no se puede verificar {d} (falta {api_path})"); continue
            else: ds = "desconocida"
            if ds != "done": bad(f"{i}: in_progress pero la dependencia {d} está '{ds}'")
        cc = f.get("consumes_contract", None)
        if "consumes_contract" in f and f.get("sdd"):
            if cc is None: bad(f"{i}: in_progress sin consumes_contract declarado")
            elif snap_ver is None or cc.split(".")[0] != snap_ver.split(".")[0]:
                bad(f"{i}: consume contrato {cc} pero el snapshot es {snap_ver}")
n_ip = sum(f["status"] == "in_progress" for f in feats)
if n_ip > 1: bad(f"{n_ip} features en in_progress (máximo 1)")
if errs == 0:
    counts = {}
    for f in feats: counts[f["status"]] = counts.get(f["status"], 0) + 1
    print("[OK]   feature_list.json coherente (" + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) + ")")
PYEOF
read -r -d '' JS <<'JSEOF'
const fs = require("fs"), ex = fs.existsSync;
const fl = JSON.parse(fs.readFileSync("feature_list.json")), feats = fl.features, valid = new Set(fl.rules.valid_status);
const byId = Object.fromEntries(feats.map(f => [f.id, f]));
const apiPath = "../asclepio-api/feature_list.json";
const api = ex(apiPath) ? Object.fromEntries(JSON.parse(fs.readFileSync(apiPath)).features.map(f => [f.id, f])) : null;
const f00 = (feats.find(f => f.global_id === "F-00") || {}).status || "pending";
console.log("F00=" + f00);
const snap = fl.project !== "asclepio-api" ? "../asclepio-api/openapi/asclepio-api.v1.json" : "openapi/asclepio-api.v1.json";
const snapVer = ex(snap) ? (JSON.parse(fs.readFileSync(snap)).info || {}).version : null;
let errs = 0; const bad = m => { errs++; console.log("[FAIL] " + m); };
for (const f of feats) {
  const i = f.id, s = f.status;
  if (!valid.has(s)) bad(`${i}: estado inválido '${s}'`);
  if (s === "in_progress" && !ex(`progress/current/${i}.md`)) bad(`${i}: in_progress sin progress/current/${i}.md`);
  if (f.sdd && ["spec_ready", "in_progress", "done"].includes(s)) {
    const miss = ["requirements.md", "design.md", "tasks.md"].filter(n => !ex(`specs/${i}/${n}`));
    if (miss.length) bad(`${i}: sdd en '${s}' sin specs/${i}/${miss.join(", ")}`);
  }
  if (s === "in_progress") {
    for (const d of f.depends_on) {
      let ds;
      if (byId[d]) ds = byId[d].status;
      else if (d.endsWith("-api") && api) ds = (api[d] || {}).status || "desconocida";
      else if (d.endsWith("-api")) { console.log(`[WARN] ${i}: no se puede verificar ${d} (falta ${apiPath})`); continue; }
      else ds = "desconocida";
      if (ds !== "done") bad(`${i}: in_progress pero la dependencia ${d} está '${ds}'`);
    }
    if ("consumes_contract" in f && f.sdd) {
      const cc = f.consumes_contract;
      if (cc == null) bad(`${i}: in_progress sin consumes_contract declarado`);
      else if (!snapVer || cc.split(".")[0] !== snapVer.split(".")[0]) bad(`${i}: consume contrato ${cc} pero el snapshot es ${snapVer}`);
    }
  }
}
const nIp = feats.filter(f => f.status === "in_progress").length;
if (nIp > 1) bad(`${nIp} features en in_progress (máximo 1)`);
if (!errs) {
  const c = {}; feats.forEach(f => c[f.status] = (c[f.status] || 0) + 1);
  console.log("[OK]   feature_list.json coherente (" + Object.keys(c).sort().map(k => `${k}: ${c[k]}`).join(", ") + ")");
}
JSEOF

section "3. Estado (feature_list.json)"
if command -v python3 >/dev/null; then STATE=$(python3 -c "$PY" 2>&1)
elif command -v node >/dev/null; then STATE=$(node -e "$JS" 2>&1)
else STATE="F00=pending"$'\n'"[FAIL] Se necesita python3 o node para validar feature_list.json"; fi
F00=$(echo "$STATE" | sed -n 's/^F00=//p' | head -1)
if [[ -z "$F00" ]]; then
  fail "feature_list.json no se pudo leer: $(echo "$STATE" | tail -1)"; F00=pending
fi
while IFS= read -r line; do
  case "$line" in
    "[OK]"*)   echo "$line" ;;
    "[WARN]"*) echo "$line"; WARNS=$((WARNS + 1)) ;;
    "[FAIL]"*) echo "$line"; FAILS=$((FAILS + 1)) ;;
  esac
done <<< "$STATE"

# ---------------------------------------------------------------- 4. Variables de entorno
section "4. Configuración local"
miss_cfg() { if [[ "$F00" == "done" ]]; then fail "$*"; else warn "$* (aceptable mientras F-00 no esté done)"; fi; }
check_keys() {  # $1 = archivo, resto = claves. Nunca imprime valores.
  local file=$1; shift
  if [[ ! -f "$file" ]]; then miss_cfg "$file no existe (copia desde la plantilla)"; return; fi
  local missing=()
  for k in "$@"; do grep -Eq "^[[:space:]]*${k}[[:space:]]*=[[:space:]]*[^[:space:]]" "$file" || missing+=("$k"); done
  ((${#missing[@]})) && miss_cfg "$file sin definir: ${missing[*]}" || ok "$file define: $*"
}
case "$REPO" in
  api)    check_keys .env DATABASE_URL DIRECT_URL JWT_SECRET GROQ_API_KEY OPENROUTER_API_KEY ;;
  web)    check_keys .env VITE_API_URL ;;
  mobile) check_keys local.properties API_BASE_URL ;;
esac

# ---------------------------------------------------------------- 5. Calidad
section "5. Calidad"
LOG=$(mktemp); trap 'rm -f "$LOG"' EXIT
run() {  # $1 = etiqueta, resto = comando
  local label=$1; shift
  if "$@" >"$LOG" 2>&1; then ok "$label"; else fail "$label"; tail -n 25 "$LOG" | sed 's/^/       /'; fi
}
if [[ $QUICK == 1 ]]; then
  echo "(omitido por --quick)"
elif [[ "$REPO" == "mobile" ]]; then
  if [[ -x ./gradlew ]]; then run "gradlew lint testDebugUnitTest" ./gradlew --no-daemon -q lint testDebugUnitTest
  else warn "Esqueleto Android inexistente (F-00-mobile pendiente): calidad omitida"; fi
else
  if [[ ! -f package.json ]]; then
    warn "Esqueleto de la app inexistente (F-00-$REPO pendiente): calidad omitida"
  elif [[ ! -d node_modules ]]; then
    fail "node_modules ausente: ejecuta npm install"
  else
    run "lint"      npm run -s lint
    run "typecheck" npm run -s typecheck
    [[ "$REPO" == "api" ]] && run "prisma validate" npx --no-install prisma validate
    run "tests"     npm test --silent
  fi
fi

# ---------------------------------------------------------------- Resumen
section "Resumen"
echo "FAIL: $FAILS · WARN: $WARNS"
if ((FAILS)); then echo "Estado: ROJO — corrige los [FAIL] antes de continuar."; exit 1; fi
echo "Estado: VERDE$( ((WARNS)) && echo ' (con advertencias)')"
exit 0
