#!/usr/bin/env bash
# Install the EPC platform on one Ubuntu 24.04 server, for a demo or a pilot.
#
#   sudo bash deploy/vps/install.sh
#
# What it sets up, and why each piece:
#   - Node 22 in /opt/node            Ubuntu's own nodejs is too old for Next 15.
#   - user `epc`                      the app never runs as root.
#   - /var/lib/epc/{db,files,backups} PGlite database, uploaded files, backups —
#                                     outside the checkout, so an update cannot touch them.
#   - /etc/epc/epc.env                the server's settings; SESSION_SECRET is made once
#                                     and kept on every re-run. AUTH_MODE is NOT set:
#                                     dev mode trusts a header and is never for a public URL.
#   - systemd `epc`                   next start on 127.0.0.1:3000, restarted on failure.
#   - Caddy                           HTTPS in front of it. HTTPS is not optional: the
#                                     login cookie is Secure, so over plain http nobody
#                                     can sign in.
#   - systemd timer `epc-backup`      a verified database backup every night at 02:40 Tehran.
#   - /usr/local/bin/epc              one command for admin, demo data, update, backup, logs.
#
# Safe to run again: every step checks what is already there.
#
# Settings (all optional, as environment variables):
#   DOMAIN=epc.example.ir    default: <server-ip>.sslip.io, which needs no DNS
#   TLS_MODE=internal        self-signed certificate, for when Let's Encrypt is unreachable
#   ACME_EMAIL=you@x.com     the address Let's Encrypt writes to about expiry
#   ADMIN_EMAIL=you@x.com    create the first account and print its password
#   ADMIN_NAME='نام شما'
#   DEMO=1                   also fill that account's DEMO project with sample data
#   NODE_MIRROR=https://...  a mirror of https://nodejs.org/dist
#   NPM_REGISTRY=https://... a mirror of the npm registry
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA=/var/lib/epc
ETC=/etc/epc
ENV_FILE=$ETC/epc.env
NODE_DIR=/opt/node
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
PORT=3000

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*" >&2; }
ok()   { printf '   [ ok ] %s\n' "$*" >&2; }
warn() { printf '   [ !! ] %s\n' "$*" >&2; }
die()  { printf '   [FAIL] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "با root اجرا کنید: sudo bash $0"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "این اسکریپت برای Ubuntu 24.04 نوشته و آزموده شده؛ اینجا $PRETTY_NAME است."
[ -f "$APP_DIR/package.json" ] || die "اسکریپت باید از داخل مخزن اجرا شود ($APP_DIR)."

# ── 1. system packages ────────────────────────────────────────────────────
say "۱. بسته‌های سیستم"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates xz-utils caddy tesseract-ocr poppler-utils python3-opencv python3-numpy >/dev/null
ok "git, curl, caddy $(caddy version 2>/dev/null | cut -d' ' -f1)"

# ── 2. Node 22 ────────────────────────────────────────────────────────────
say "۲. Node.js 22"
if [ -x "$NODE_DIR/bin/node" ] && "$NODE_DIR/bin/node" -v | grep -q '^v22\.'; then
  ok "از قبل نصب است: $("$NODE_DIR/bin/node" -v)"
else
  arch=$(uname -m); case "$arch" in x86_64) arch=x64;; aarch64) arch=arm64;; *) die "معماری پشتیبانی‌نشده: $arch";; esac
  tmp=$(mktemp -d)
  curl -fsSL --retry 3 "$NODE_MIRROR/latest-v22.x/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" \
    || die "به $NODE_MIRROR دسترسی نیست. با NODE_MIRROR=<آینه> دوباره اجرا کنید."
  file=$(grep -o "node-v22[^ ]*-linux-$arch.tar.xz" "$tmp/SHASUMS256.txt" | head -1)
  [ -n "$file" ] || die "نسخهٔ لینوکس $arch در فهرست نیست."
  curl -fsSL --retry 3 "$NODE_MIRROR/latest-v22.x/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet) || die "checksum فایل Node نخواند — دانلود خراب است."
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
  ok "نصب شد: $("$NODE_DIR/bin/node" -v)"
fi
for b in node npm npx; do ln -sf "$NODE_DIR/bin/$b" /usr/local/bin/$b; done

# ── 3. swap: `next build` wants about 2 GB ────────────────────────────────
say "۳. حافظه"
mem_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3500 ] && [ "$swap_mb" -lt 1024 ]; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "رم ${mem_mb}MB — ۲ گیگ swap اضافه شد"
else
  ok "رم ${mem_mb}MB، swap ${swap_mb}MB — کافی است"
fi

# ── 4. user and directories ───────────────────────────────────────────────
say "۴. کاربر epc و پوشه‌ها"
id epc >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin epc
install -d -o epc -g epc -m 750 "$DATA" "$DATA/db" "$DATA/files" "$DATA/backups"
install -d -o root -g epc -m 750 "$ETC"
chown -R epc:epc "$APP_DIR"
ok "برنامه: $APP_DIR — داده: $DATA"

# ── 5. settings ───────────────────────────────────────────────────────────
say "۵. تنظیمات ($ENV_FILE)"
if [ -z "${DOMAIN:-}" ]; then
  if [ -f "$ENV_FILE" ] && grep -q '^APP_URL=' "$ENV_FILE"; then
    DOMAIN=$(sed -n 's#^APP_URL=https://##p' "$ENV_FILE")
  else
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
    case "$ip" in 10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|"")
      ip=$(curl -fsS --max-time 8 https://api.ipify.org || true);; esac
    [ -n "$ip" ] || die "IP عمومی سرور پیدا نشد. با DOMAIN=<دامنه> اجرا کنید."
    DOMAIN="${ip//./-}.sslip.io"
  fi
fi
if [ ! -f "$ENV_FILE" ]; then
  secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > "$ENV_FILE" <<ENV
# EPC platform — server settings. Read by systemd and by the \`epc\` command.
# Do NOT add AUTH_MODE=dev here: it lets anyone act as any user.
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
SESSION_SECRET=$secret
APP_URL=https://$DOMAIN
PGLITE_DIR=$DATA/db
STORAGE_DRIVER=local
STORAGE_ROOT=$DATA/files
BACKUP_DIR=$DATA/backups
# Model features (drawing extraction). Without a key the rest of the platform works.
# ANTHROPIC_API_KEY=
# «فراموشی رمز» با ایمیل: با این‌ها لینک بازیابی به ایمیل خود کاربر فرستاده می‌شود؛
# بدون آن‌ها درخواست برای مدیر سامانه ثبت می‌شود.
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM=
ENV
  ok "ساخته شد؛ SESSION_SECRET تازه"
else
  sed -i "s#^APP_URL=.*#APP_URL=https://$DOMAIN#" "$ENV_FILE"
  grep -q '^AUTH_MODE=dev' "$ENV_FILE" && die "AUTH_MODE=dev در $ENV_FILE هست؛ آن را حذف کنید — روی نشانی عمومی هر کسی خودش را هر کاربری جا می‌زند."
  ok "موجود بود؛ SESSION_SECRET دست نخورد"
fi
chown root:epc "$ENV_FILE"; chmod 640 "$ENV_FILE"
if [ -f "$APP_DIR/.env.local" ] && grep -q '^AUTH_MODE=dev' "$APP_DIR/.env.local"; then
  die "$APP_DIR/.env.local حالت AUTH_MODE=dev دارد و Next آن را می‌خواند. این فایل مال گوشی است؛ از سرور حذفش کنید."
fi

# ── 6. the helper command ─────────────────────────────────────────────────
install -m 755 "$APP_DIR/deploy/vps/epc" /usr/local/bin/epc
sed -i "s#^APP_DIR=.*#APP_DIR=$APP_DIR#" /usr/local/bin/epc

# ── 7. dependencies, build, migrations ────────────────────────────────────
say "۶. نصب وابستگی‌ها و build (چند دقیقه)"
systemctl stop epc 2>/dev/null || true
/usr/local/bin/epc _build
say "۷. پایگاه داده"
/usr/local/bin/epc _run npm run db:migrate

# ── 8. service ────────────────────────────────────────────────────────────
say "۸. سرویس"
sed "s#@APP_DIR@#$APP_DIR#g; s#@PORT@#$PORT#g" "$APP_DIR/deploy/vps/epc.service" > /etc/systemd/system/epc.service
install -m 644 "$APP_DIR/deploy/vps/epc-backup.service" /etc/systemd/system/epc-backup.service
install -m 644 "$APP_DIR/deploy/vps/epc-backup.timer"   /etc/systemd/system/epc-backup.timer
systemctl daemon-reload
systemctl enable --now epc-backup.timer >/dev/null 2>&1
if [ -n "${ADMIN_EMAIL:-}" ]; then
  /usr/local/bin/epc _run npm run auth:admin -- "$ADMIN_EMAIL" "" "${ADMIN_NAME:-}"
  [ "${DEMO:-}" = 1 ] && /usr/local/bin/epc _run npm run demo:seed -- "$ADMIN_EMAIL"
fi
systemctl enable epc >/dev/null 2>&1
systemctl restart epc
/usr/local/bin/epc _wait || die "سرویس بالا نیامد. ببینید: journalctl -u epc -n 80"
ok "epc روی 127.0.0.1:$PORT"

# ── 9. HTTPS ──────────────────────────────────────────────────────────────
say "۹. HTTPS با Caddy ($DOMAIN)"
{
  echo "# Written by deploy/vps/install.sh — re-run it rather than editing by hand."
  if [ -n "${ACME_EMAIL:-}" ]; then echo "{"; echo "	email $ACME_EMAIL"; echo "}"; fi
  # Second name on a different DNS service: some networks (a Windows PC behind
  # one ISP's resolver, say) cannot resolve sslip.io while a phone on mobile
  # data can. Same site, so whichever name resolves is the one to open.
  names="$DOMAIN"
  case "$DOMAIN" in *.sslip.io) names="$DOMAIN, ${DOMAIN%.sslip.io}.nip.io";; esac
  [ -n "${ALIASES:-}" ] && names="$names, ${ALIASES//,/, }"
  echo "$names {"
  [ "${TLS_MODE:-}" = internal ] && echo "	tls internal"
  echo "	encode gzip"
  echo "	reverse_proxy 127.0.0.1:$PORT"
  echo "}"
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || die "Caddyfile نامعتبر است."
systemctl enable caddy >/dev/null 2>&1; systemctl reload-or-restart caddy
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ok "پورت‌های ۸۰ و ۴۴۳ در ufw باز شد"
fi

https_ok=no
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null --max-time 10 --noproxy "*" --resolve "$DOMAIN:443:127.0.0.1" ${TLS_MODE:+-k} "https://$DOMAIN/"; then https_ok=yes; break; fi
  sleep 3
done

say "تمام"
if [ "$https_ok" = yes ]; then ok "باز کنید: https://$DOMAIN"
else
  warn "https://$DOMAIN هنوز جواب نداد. معمولاً یعنی گواهی گرفته نشد:"
  warn "  journalctl -u caddy -n 50      (پیام Let's Encrypt را ببینید)"
  warn "  پورت ۸۰ و ۴۴۳ در فایروال ارائه‌دهنده باز است؟"
  warn "  راه موقت: TLS_MODE=internal bash $0  (مرورگر هشدار می‌دهد ولی کار می‌کند)"
fi
[ -n "${ADMIN_EMAIL:-}" ] || echo "   حساب مدیر:  epc admin you@example.com 'نام شما'" >&2
echo "   راهنما:     epc help" >&2
