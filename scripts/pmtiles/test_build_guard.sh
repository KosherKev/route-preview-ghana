#!/usr/bin/env bash
# Tests for the sea-step guard in build-accra.sh. Runs in a throwaway copy of the scripts (no Planetiler run, no real data touched).
# Usage: scripts/pmtiles/test_build_guard.sh        Exit 0 if all pass.
set -u
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/scripts/pmtiles" "$T/data/osm" "$T/data/tmp" "$T/bin"
cp "$SRC"/scripts/pmtiles/build-accra.sh "$SRC"/scripts/pmtiles/accra-*.yml "$T/scripts/pmtiles/"
touch "$T/scripts/pmtiles/osm_coast.py" "$T/scripts/pmtiles/build_sea.py" "$T/data/osm/ghana-latest.osm.pbf"
ln -s "$SRC/data/tools" "$T/data/tools"
# fake python: logs its arguments; $FAKE_MODE decides what it does (ok: writes the output file, skip: writes nothing, fail: exits 1)
cat > "$T/bin/py" <<'PY'
#!/usr/bin/env bash
echo "$@" >> "$FAKE_LOG"
last="${@: -1}"; script="$2"
case "$FAKE_MODE" in
  fail) exit 1 ;;
  skip) exit 0 ;;
  ok) case "$script" in
        *osm_coast.py) echo '{}' > "$4" ;;
        *build_sea.py) sleep 1; echo gpkg > "$4" ;;
      esac ;;
esac
PY
chmod +x "$T/bin/py"
FAILS=0
t() { if [ "$2" = ok ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS + 1)); fi; }
run() { (cd "$T" && FAKE_LOG="$T/log" FAKE_MODE="$1" SEA_PY="$T/bin/py" SEA_ONLY=1 bash "${2}" -0.40,5.45,0.05,5.80 out.pmtiles "${3}" 2>&1); }
: > "$T/log"

# 1. every equivalent path form of the v2 schema runs the sea step
for form in scripts/pmtiles/accra-base.yml ./scripts/pmtiles/accra-base.yml scripts/pmtiles/../pmtiles/accra-base.yml "$T/scripts/pmtiles/accra-base.yml"; do
  rm -f "$T/data/tmp/sea.gpkg" "$T/data/tmp/coast.json"; : > "$T/log"
  out="$(run ok scripts/pmtiles/build-accra.sh "$form")"; rc=$?
  if grep -q build_sea.py "$T/log" && [ -s "$T/data/tmp/sea.gpkg" ]; then t "sea step runs for schema path form: $form" ok; else t "sea step runs for schema path form: $form ($out)" no; fi
done
# 2. the v1 schema does not run the sea step
: > "$T/log"; rm -f "$T/data/tmp/sea.gpkg"
run ok scripts/pmtiles/build-accra.sh scripts/pmtiles/accra-buildings.yml >/dev/null
if ! grep -q build_sea.py "$T/log"; then t "v1 schema skips the sea step" ok; else t "v1 schema skips the sea step" no; fi
# 3. a stale sea.gpkg is not reused when the step does not produce one (skip mode: python exits 0 and writes nothing)
echo stale > "$T/data/tmp/sea.gpkg"; rm -f "$T/data/tmp/coast.json"
out="$(run skip scripts/pmtiles/build-accra.sh scripts/pmtiles/accra-base.yml)"; rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "ERROR" && [ ! -e "$T/data/tmp/sea.gpkg" ]; then t "stale sea.gpkg removed and run fails with a clear error (rc=$rc)" ok; else t "stale sea.gpkg removed and run fails (rc=$rc: $out)" no; fi
# 4. build_sea.py failing fails the build
out="$(run fail scripts/pmtiles/build-accra.sh scripts/pmtiles/accra-base.yml)"; rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "ERROR"; then t "failing sea step fails the build (rc=$rc)" ok; else t "failing sea step fails the build (rc=$rc: $out)" no; fi
# 5. a sea.gpkg older than its input is refused
rm -f "$T/data/tmp/sea.gpkg"; echo '{}' > "$T/data/tmp/coast.json"; sleep 1; touch "$T/data/osm/ghana-latest.osm.pbf"; sleep 1; touch "$T/data/tmp/coast.json"
cat > "$T/bin/py2" <<'PY'
#!/usr/bin/env bash
# writes a gpkg and then back-dates it, as a stale leftover would be
echo gpkg > "$4"; touch -t 200001010000 "$4"
PY
chmod +x "$T/bin/py2"
out="$( (cd "$T" && FAKE_LOG="$T/log" SEA_PY="$T/bin/py2" SEA_ONLY=1 bash scripts/pmtiles/build-accra.sh -0.40,5.45,0.05,5.80 out.pmtiles scripts/pmtiles/accra-base.yml 2>&1) )"; rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "not newer"; then t "sea.gpkg older than its input is refused (rc=$rc)" ok; else t "sea.gpkg older than its input is refused (rc=$rc: $out)" no; fi
[ "$FAILS" -eq 0 ] && echo "ALL BUILD-GUARD TESTS PASSED" || echo "$FAILS FAILED"
exit "$FAILS"
