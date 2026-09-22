#!/data/data/com.termux/files/usr/bin/bash
#
# Bring this project up on an Android phone, under Termux.
#
#   bash tools/termux-setup.sh
#
# Idempotent: safe to run again after a failure or an update.
#
# WHAT IS DIFFERENT ON A PHONE
#
#   Next.js ships its compiler (SWC) as a native binary per platform. Android
#   has no such binary, and — this took two rounds to get right — Next does
#   NOT reliably fall back to its WebAssembly build on its own: that fallback
#   is gated behind next.config.mjs's experimental.useWasmBinary (set in this
#   repo), and even with it set, Next's own first move is still to try
#   requiring the WASM package from node_modules before it will use it — if
#   that package is not there, what happens next depends on the device's
#   network at that exact moment, and on this phone that path did not land
#   cleanly. So this script installs @next/swc-wasm-nodejs directly: once it
#   is sitting in node_modules, Next requires it locally and never touches
#   the network for this at all. Verified directly here (not on Android, that
#   package has no native code to differ by platform): the WASM binary
#   compiles real JSX correctly.
#
#   PGlite is WebAssembly PostgreSQL and also runs here, but it holds the
#   whole database in the process. Termux ships a real PostgreSQL, which is
#   lighter on a phone and is what this script sets up.
#
set -u

# ── why everything below prints to stderr, and to a file ──────────────────
#
# The phone terminal this was written for shows stderr and SWALLOWS stdout.
# The first two runs of this script therefore looked like they printed almost
# nothing: every step/ok/warn line went to stdout and vanished, while npm's
# own notices — which npm writes to stderr — were the only thing visible. An
# hour went into diagnosing a script that had very likely been working.
#
# So: progress goes to stderr, where a terminal that filters will still show
# it, and a copy of everything goes to setup.log, because a phone's scrollback
# is a few lines deep and the interesting part is always the part that
# scrolled away. The markers are plain ASCII for the same reason — a terminal
# that cannot render one glyph should not be able to hide a failure.

if [ "${TERMUX_SETUP_LOGGING:-}" != "1" ]; then
  export TERMUX_SETUP_LOGGING=1
  LOG="$PWD/setup.log"
  # Re-exec through tee rather than exec>(tee): a process substitution can be
  # killed before it flushes, and the lines lost are the last ones — exactly
  # the ones that say what went wrong.
  bash "$0" "$@" 2>&1 | tee "$LOG" >&2
  exit "${PIPESTATUS[0]}"
fi

step() { printf '\n== %s ==\n' "$1" >&2; }
ok()   { printf '  [ ok ] %s\n' "$1" >&2; }
warn() { printf '  [ !! ] %s\n' "$1" >&2; }
die()  { printf '  [FAIL] %s\n' "$1" >&2; printf 'SUMMARY: FAILED\n' >&2; exit 1; }

[ -f package.json ] || die "این اسکریپت را از ریشهٔ مخزن اجرا کنید."

step "۱ · بسته‌ها"
for p in nodejs-lts git postgresql; do
  if pkg list-installed 2>/dev/null | grep -q "^$p/"; then
    ok "$p"
  else
    pkg install -y "$p" >/dev/null 2>&1 && ok "$p نصب شد" || die "نصب $p شکست خورد"
  fi
done
node --version | sed 's/^/  node /'

step "۲ · PostgreSQL"
PGDATA="$PREFIX/var/lib/postgresql"
if [ ! -d "$PGDATA/base" ]; then
  mkdir -p "$PGDATA"
  initdb "$PGDATA" >/dev/null 2>&1 && ok "خوشه ساخته شد" || die "initdb شکست خورد"
else
  ok "خوشه از قبل هست"
fi

if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  ok "در حال اجرا"
else
  # Android has no /run, so the socket goes somewhere writable.
  pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-k $PREFIX/tmp" start >/dev/null 2>&1
  sleep 2
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 \
    && ok "بالا آمد" \
    || die "بالا نیامد — لاگ: $PGDATA/server.log"
fi

DBUSER="$(whoami)"
if psql -h "$PREFIX/tmp" -lqt postgres 2>/dev/null | cut -d\| -f1 | grep -qw isoweld; then
  ok "دیتابیس isoweld هست"
else
  createdb -h "$PREFIX/tmp" isoweld >/dev/null 2>&1 \
    && ok "دیتابیس isoweld ساخته شد" \
    || die "createdb شکست خورد"
fi

step "۳ · وابستگی‌ها"
# Optional native packages (@napi-rs/canvas, the platform SWC binaries) have no
# Android build. They are optional; npm warns and carries on. --no-audit and
# --no-fund keep a slow mobile connection from doing work nobody reads.
npm install --no-audit --no-fund 2>&1 | tail -3
[ -d node_modules/next ] || die "npm install کامل نشد"
ok "node_modules"

step "۳.۵ · کامپایلر WASM"
# Not in package.json on purpose — 54 MB that only Android needs. Installed
# here with --no-save so every other platform's install stays untouched.
# Pinned to the exact Next version: SWC's wasm and native builds must match.
NEXT_VER="$(node -p "require('./package.json').dependencies.next")"
if [ -d node_modules/@next/swc-wasm-nodejs ]; then
  ok "از قبل نصب است"
else
  npm install --no-save --no-audit --no-fund "@next/swc-wasm-nodejs@${NEXT_VER}" \
    >/dev/null 2>&1 \
    && ok "نصب شد (نسخهٔ ${NEXT_VER})" \
    || die "نصب کامپایلر WASM شکست خورد — اتصال اینترنت را بررسی کنید"
fi

step "۴ · فایل پیکربندی"
if [ -f .env.local ]; then
  ok ".env.local از قبل هست — دست نخورد"
else
  cat > .env.local <<ENV
AUTH_MODE=dev
LLM_PROVIDER=anthropic

# سوکت یونیکس، چون اندروید شبکهٔ لوکال‌هاست را هم محدود می‌کند
DATABASE_URL=postgresql://$DBUSER@localhost/isoweld?host=$PREFIX/tmp

STORAGE_ROOT=.storage

# کلید را اینجا بگذارید:
# ANTHROPIC_API_KEY=sk-ant-...
ENV
  ok ".env.local ساخته شد"
fi
grep -q '^ANTHROPIC_API_KEY=' .env.local \
  && ok "کلید تنظیم شده" \
  || warn "کلید تنظیم نشده — بدون آن همه‌چیز جز استخراج کار می‌کند"

step "۵ · Migration و داده"
npm run db:migrate >/dev/null 2>&1 && ok "migration ها اعمال شد" || die "migration شکست خورد"

step "۶ · بررسی"
npm run doctor

# ── one line, pure ASCII, last ───────────────────────────────────────────
# Whatever else a narrow terminal loses, this is the line worth keeping: it
# answers, without scrolling, the three questions a failure here turns on.
PG=down;   pg_ctl -D "$PGDATA" status >/dev/null 2>&1 && PG=up
WASM=no;   [ -d node_modules/@next/swc-wasm-nodejs ] && WASM=yes
KEY=no;    grep -q '^ANTHROPIC_API_KEY=' .env.local 2>/dev/null && KEY=yes
printf '\nSUMMARY: pg=%s wasm=%s key=%s log=%s/setup.log\n' \
  "$PG" "$WASM" "$KEY" "$PWD" >&2

cat <<'NEXT'

── اجرا ────────────────────────────────────────────────────────────────
  npm run dev
  مرورگر گوشی → http://localhost:3000

  اولین کامپایل روی گوشی کند است (کامپایلر WASM). بعدی‌ها سریع‌ترند.
  `npm run build` حافظهٔ زیادی می‌خواهد؛ روی گوشی حالت dev را ترجیح دهید.

  پایگاه داده بعد از ری‌استارت ترماکس بالا نمی‌آید. دوباره:
    pg_ctl -D $PREFIX/var/lib/postgresql -o "-k $PREFIX/tmp" start

  اگر بعداً "Failed to load SWC binary" دوباره دیدید — یعنی یک `npm install`
  ساده (بدون --no-save) کامپایلر WASM را که این اسکریپت جدا نصب کرده بود
  پاک کرده. همین اسکریپت را دوباره اجرا کنید؛ فقط همان قدم را تکرار می‌کند.
NEXT
