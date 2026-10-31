#!/usr/bin/env bash
# Runs a CI command; on failure, turns the important log lines into GitHub annotations so the
# error can be read through the API (check-run annotations) without opening the raw log.
LOG=$(mktemp)
"$@" 2>&1 | tee "$LOG"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
    python3 - "$LOG" "$*" <<'PY'
import re, sys
lines = open(sys.argv[1], errors="replace").read().splitlines()
key = [l for l in lines if re.search(r"(error|Error|ERROR|FAILED|failed|Exception|e: |What went wrong|Caused by|AssertionError|expected)", l)]
picked = (key[:60] + ["----- tail -----"] + lines[-40:])
chunks = [picked[i:i + 25] for i in range(0, len(picked), 25)][:9]
for i, c in enumerate(chunks):
    msg = "%0A".join(x.replace("%", "%25").replace("\r", "")[:300] for x in c)
    print(f"::error title={sys.argv[2][:60]} ({i + 1}/{len(chunks)})::{msg}")
PY
fi
exit "$code"
