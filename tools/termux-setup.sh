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
#   Next.js ships its compiler as a native binary per platform. Android is
#   neither glibc nor musl, so that binary will not load and Next falls back
#   to a WebAssembly build of the same compiler. It works; it is slower. The
#   fallback is automatic and the warning it prints is expected, not a fault.
#
#   PGlite is WebAssembly PostgreSQL and also runs here, but it holds the
#   whole database in the process. Termux ships a real PostgreSQL, which is
#   lighter on a phone and is what this script sets up.
#
set -u

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m×\033[0m %s\n' "$1" >&2; exit 1; }

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

cat <<'NEXT'

── اجرا ────────────────────────────────────────────────────────────────
  npm run dev
  مرورگر گوشی → http://localhost:3000

  اولین کامپایل روی گوشی کند است (کامپایلر WASM). بعدی‌ها سریع‌ترند.
  `npm run build` حافظهٔ زیادی می‌خواهد؛ روی گوشی حالت dev را ترجیح دهید.

  پایگاه داده بعد از ری‌استارت ترماکس بالا نمی‌آید. دوباره:
    pg_ctl -D $PREFIX/var/lib/postgresql -o "-k $PREFIX/tmp" start
NEXT
