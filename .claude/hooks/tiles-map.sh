#!/bin/bash
# After a page or component is edited, regenerate lib/platform/tile-apis.mjs (the page→API map).
# `db:test` fails with «tile-apis.mjs is out of date» when a page's API calls change and this is
# not re-run. It takes under a second and changes nothing when nothing changed. Never blocks.
set -uo pipefail
f=$(cat | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))
except Exception: print("")' 2>/dev/null)
case "$f" in
  */app/*|*/components/*|*/lib/client/*) ;;
  *) exit 0 ;;
esac
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
npm run --silent tiles:map >/dev/null 2>&1 || echo "tiles:map failed — run it by hand before committing" >&2
exit 0
