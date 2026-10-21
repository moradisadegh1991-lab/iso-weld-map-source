# نصب روی یک سرور Ubuntu (VPS) — برای دمو و تست

یک سرور، یک دستور. پایگاه داده (PGlite) و فایل‌ها روی دیسک همان سرور می‌مانند؛ Postgres یا
MinIO جدا لازم نیست. برای چند کاربر همزمانِ یک پروژهٔ نمونه کافی است.

| لازم است | توضیح |
|---|---|
| Ubuntu 24.04، دسترسی root | ۲ هسته، ۲ تا ۴ گیگ رم، ۲۰ گیگ دیسک آزاد |
| پورت ۲۲، ۸۰ و ۴۴۳ باز | در پنل ارائه‌دهنده (فایروال ابری) هم چک کنید |
| یک توکن GitHub | مخزن خصوصی است — پایین‌تر توضیح داده شده |
| دامنه (اختیاری) | بدون دامنه، نشانی `https://<IP-با-خط-تیره>.sslip.io` ساخته می‌شود |

## ۱. توکن GitHub (یک‌بار، از گوشی)

github.com ◄ Settings ◄ Developer settings ◄ **Fine-grained tokens** ◄ Generate new token

- Repository access: **Only select repositories** ◄ `iso-weld-map-source`
- Permissions ◄ Repository ◄ **Contents: Read-only** (و هیچ چیز دیگر)
- یک تاریخ انقضا بگذارید.

توکن فقط خواندن همین یک مخزن را اجازه می‌دهد.

## ۲. نصب (روی سرور، به‌صورت root)

```bash
read -rsp "GitHub token: " T; echo
git clone --depth 1 -b master \
  "https://x-access-token:$T@github.com/moradisadegh1991-lab/iso-weld-map-source.git" /opt/epc/app
git -C /opt/epc/app remote set-url origin https://github.com/moradisadegh1991-lab/iso-weld-map-source.git
cd /opt/epc/app
ADMIN_EMAIL=you@example.com ADMIN_NAME='نام شما' DEMO=1 bash deploy/vps/install.sh
```

خط سوم توکن را از تنظیمات git پاک می‌کند. سرور شاخهٔ `master` را دنبال می‌کند؛ `epc update`
همیشه آخرین نسخهٔ همان شاخه‌ای را می‌گیرد که سرور رویش است.

**سروری که پیش از ادغام PR #1 از شاخهٔ `claude/vigilant-brown-wnaksu` نصب شده** یک بار باید
به `master` برگردد (بدون اینترنت؛ فقط نام شاخهٔ محلی عوض می‌شود). بعد از آن `epc update` کافی است:

```bash
sudo epc backup
sudo runuser -u epc -- git -C /opt/epc/app checkout -B master
sudo epc update
```

**سروری که پیش از «خواندن نقشه بدون مدل» نصب شده** (پیش از ۲۹ مهر ۱۴۰۵) بستهٔ سیستمی
آن را ندارد — tesseract، poppler و OpenCV — و صفحهٔ ایزومتریک برای روش «بدون مدل» می‌گوید
کدام نیست. `epc update`ِ قدیمی بستهٔ سیستم نصب نمی‌کرد؛ یک بار:

```bash
sudo epc update
sudo bash /opt/epc/app/deploy/vps/epc deps
```

دستور دوم بسته‌های فهرست `deploy/vps/packages.txt` را که نصب نیست نصب می‌کند و خود `epc` را
هم از نسخهٔ تازه جایگزین می‌کند. از آن به بعد `epc update` همین کار را خودش می‌کند: قابلیتی
که بستهٔ سیستمی تازه بخواهد با همان به‌روزرسانی می‌رسد. `sudo epc doctor` در ردیف «خواندن نقشه
بدون مدل» می‌گوید چیزی کم است یا نه.

نصب ۵ تا ۱۵ دقیقه طول می‌کشد (بیشترش `npm ci` و `build`). در پایان:

```
ACCOUNT READY
  email    : you@example.com
  password : ••••••••••••••••  <- shown once, not stored anywhere else
...
   [ ok ] باز کنید: https://46-34-163-248.sslip.io
```

**رمز را همان لحظه یادداشت کنید** — جای دیگری ذخیره نمی‌شود. اگر گم شد: `epc admin you@example.com`
یک رمز تازه می‌سازد.

`DEMO=1` پروژهٔ DEMO را با دادهٔ نمونهٔ یک واحد الفین پر می‌کند. بدون آن، پروژه خالی است.

**فراموشی رمز با ایمیل (اختیاری).** اگر یک صندوق SMTP دارید، در `/etc/epc/epc.env` (همان فایلی که
`APP_URL` در آن است) این‌ها را بنویسید و `sudo systemctl restart epc` بزنید:

```
SMTP_HOST=mail.example.ir
SMTP_PORT=587
SMTP_USER=epc@example.ir
SMTP_PASS=...
SMTP_FROM="EPC Platform <epc@example.ir>"
```

از آن پس «رمز را فراموش کرده‌ام» یک لینک یک‌بارمصرف (۷۲ ساعت) به ایمیلِ ثبت‌شده روی حساب می‌فرستد.
بدون این‌ها، مثل قبل، درخواست برای مدیر سامانه ثبت می‌شود. حساب توسعه‌دهنده همیشه از راه مدیر.

اسکریپت را می‌شود دوباره اجرا کرد؛ چیزی را که هست دوباره نمی‌سازد و `SESSION_SECRET` را عوض
نمی‌کند (عوض شدنش یعنی خروج همه).

## ۳. کار روزمره — دستور `epc`

```
epc status                  وضعیت و نشانی
epc logs                    گزارش زندهٔ برنامه (Ctrl+C)
epc restart                 راه‌اندازی دوباره
epc admin <email> ['نام']    ساخت حساب / رمز تازه برای حساب موجود
epc demo <email>            پر کردن پروژهٔ DEMO آن مدیر با دادهٔ نمونه
epc backup                  پشتیبان وارسی‌شده — هر شب ۰۲:۴۰ به وقت تهران خودکار هم گرفته می‌شود
epc backups                 فهرست پشتیبان‌ها (در /var/lib/epc/backups، ۱۴ تای آخر)
epc save-token              ذخیرهٔ توکن GitHub تا update هر بار نپرسد
epc update                  آخرین نسخه از GitHub، بسته‌های سیستمِ تازه، build، migration
epc deps                    فقط نصب بسته‌های سیستمی که نسخهٔ فعلی می‌خواهد و نصب نیست
epc doctor                  بررسی پیکربندی
epc run <script> [args]     اجرای اسکریپت بارگذاری، مثلاً: epc run furnace:load you@example.com
```

دستورهایی که با پایگاه داده کار دارند (admin، demo، backup، update) سرویس را چند ثانیه تا
چند دقیقه متوقف می‌کنند — PGlite یک‌پردازه‌ای است. `update` حدود ۵ دقیقه قطعی دارد.

**کاربران دیگر** را از داخل برنامه بسازید (منوی کاربران) تا به پروژه و نقش درست وصل شوند.
`epc admin` برای حساب دوم فقط حساب می‌سازد و پروژه‌ای به آن نمی‌دهد.

## کجا چه چیزی هست

| مسیر | محتوا |
|---|---|
| `/opt/epc/app` | کد برنامه (مالک: کاربر `epc`) |
| `/var/lib/epc/db` | پایگاه داده |
| `/var/lib/epc/files` | نقشه‌ها، مدارک، عکس‌ها، امضاها |
| `/var/lib/epc/backups` | پشتیبان‌ها |
| `/etc/epc/epc.env` | تنظیمات سرور (`SESSION_SECRET`، کلید مدل) |
| `/etc/caddy/Caddyfile` | HTTPS |

برنامه با کاربر `epc` و فقط روی `127.0.0.1:3000` اجرا می‌شود؛ از بیرون فقط Caddy (۸۰ و ۴۴۳)
دیده می‌شود.

## امنیت — دو چیز که نباید عوض شوند

1. **`AUTH_MODE=dev` روی سرور ممنوع است.** در این حالت هر کسی با یک هدر خودش را هر کاربری
   جا می‌زند. اسکریپت اگر آن را در `/etc/epc/epc.env` یا `.env.local` ببیند متوقف می‌شود.
   فایل `.env.local` گوشی را به سرور کپی نکنید.
2. **HTTPS اختیاری نیست.** کوکی ورود `Secure` است؛ روی `http://` کسی نمی‌تواند وارد شود.

پیشنهاد: ورود SSH با رمز را خاموش و با کلید وارد شوید، و رمز root پیش‌فرض ارائه‌دهنده را عوض
کنید.

## کلید مدل (اختیاری)

استخراج خودکار نقشه‌ها به مدل نیاز دارد. در `/etc/epc/epc.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

یا با **Gemini** گوگل (کلید از Google AI Studio):

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
# اختیاری: GEMINI_MODEL=gemini-3.8-flash  ·  GEMINI_REPAIR_MODEL=gemini-4-argon
```

سپس `epc restart` و `epc doctor` (ردیف «ارائه‌دهندهٔ مدل» باید gemini و پیکربندی‌شده باشد).
در صفحهٔ ایزومتریک «خواندن مدل‌ها» مدل‌های Claude و Gemini را **کنار هم** نشان می‌دهد؛ مدل
ارائه‌دهنده‌ای که تنظیم نشده غیرفعال است، و مدلی که انتخاب کنید تعیین می‌کند درخواست به کدام
برود. اگر هر دو کلید تنظیم باشد، `LLM_PROVIDER` فقط مدل پیش‌انتخاب را تعیین می‌کند
(`LLM_PROVIDERS=gemini` فقط Gemini را نشان می‌دهد).

**روی سرور ایران این معمولاً کار نمی‌کند** — نه Anthropic و نه Gemini از IP ایران سرویس
نمی‌دهند (Gemini پاسخ «User location is not supported» می‌دهد و صفحه همان را نشان می‌دهد).
برای Gemini **رلهٔ Vercel** آماده است (`deploy/gemini-relay`، راهنمای نصب در README همان
پوشه): کلید Gemini روی Vercel می‌ماند و سرور فقط توکن رله را دارد:

```
LLM_PROVIDER=gemini
GEMINI_BASE_URL=https://epc-gemini-relay.vercel.app/v1beta
GEMINI_RELAY_TOKEN=...
```

**Claude و Gemini هر دو از همان رله** (پروژهٔ `iso-weld-map-source-gemini-relay` روی Vercel، با
`ANTHROPIC_API_KEY` و `GEMINI_API_KEY` و یک `RELAY_TOKEN` در Vercel) — در سرور فقط توکن و نشانی:

```
ANTHROPIC_BASE_URL=https://<رله>.vercel.app/v1
ANTHROPIC_RELAY_TOKEN=<RELAY_TOKEN>
GEMINI_BASE_URL=https://<رله>.vercel.app/v1beta
GEMINI_RELAY_TOKEN=<RELAY_TOKEN>
```

با توکن رله، کلید مستقیم (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) روی سرور لازم نیست و به رله فرستاده
نمی‌شود. راهنمای کامل: `deploy/gemini-relay/README.md`.

### حساب مصرف توکن

هر فراخوان مدل — هر پاس خواندن ایزومتریک — با پروژه، کاربر، مدل و توکن مصرف‌شده ثبت می‌شود
(جدول `llm_usage`، فقط افزودنی). مدیر پروژه در «کاربران و دسترسی ← مصرف مدل (توکن)» می‌بیند:
جمع به تفکیک ماه، مدل، کاربر و پاس، و آخرین فراخوان‌ها. اختیاری:

```
LLM_PRICES=gemini-3.8-flash|0.30|2.50,gemini-4-argon|2|12   # قیمت هر میلیون توکن ورودی|خروجی
LLM_MONTHLY_TOKENS=5000000                                   # سهمیهٔ ماهانهٔ هر پروژه
```

قیمتی پیش‌فرض نیست — مدلی که قیمتش داده نشده فقط توکن نشان می‌دهد. پروژه‌ای که سهمیهٔ ماهش تمام
شده، پیش از صدا زدن مدل رد می‌شود (۴۲۹). بقیهٔ پلتفرم (رجیسترها، گردش‌کارها، گزارش روزانه، امضا، چاپ) بدون مدل کار می‌کند.

## اگر چیزی گیر کرد

| نشانه | معمولاً یعنی | راه |
|---|---|---|
| مرحلهٔ ۲ (Node) شکست خورد | `nodejs.org` از سرور در دسترس نیست | `NODE_MIRROR=<آینهٔ nodejs.org/dist> bash deploy/vps/install.sh` |
| `npm ci` شکست خورد یا خطای 403 داد | رجیستری npm تحریم یا فیلتر است | `NPM_REGISTRY=<آینهٔ npm> bash deploy/vps/install.sh` — آینه را از ارائه‌دهنده بپرسید |
| خطا روی `cdn.sheetjs.com` | بستهٔ `xlsx` از آنجا دانلود می‌شود | همان آینه یا یک پروکسی موقت |
| «هنوز جواب نداد» در پایان | گواهی Let's Encrypt گرفته نشد | `journalctl -u caddy -n 50`؛ پورت ۸۰/۴۴۳ در پنل؛ یا موقتاً `TLS_MODE=internal bash deploy/vps/install.sh` (مرورگر هشدار می‌دهد، کار می‌کند) |
| نشانی sslip.io برای بعضی‌ها باز نمی‌شود | DNS آن از داخل ایران مسدود است | یک دامنه (مثلاً `.ir`) با رکورد A به IP سرور، و `DOMAIN=epc.example.ir bash deploy/vps/install.sh` |
| صفحه 502 می‌دهد | برنامه بالا نیست | `epc logs` |
| ورود نمی‌شود | `http://` باز کرده‌اید یا ساعت سرور غلط است | با `https://` باز کنید؛ `timedatectl` |

## آزموده‌شده

روی یک Ubuntu 24.04 خام (۲۰۲۶-۱۰-۱۰): نصب کامل از صفر، HTTPS پشت Caddy، ورود با رمز و کوکی
`Secure`، رد شدن جعل هویت با هدر (بدون `AUTH_MODE=dev`)، ساخت حساب دوم، پشتیبان وارسی‌شده،
و `epc update` تا بالا آمدن دوبارهٔ سرویس. systemd در محیط تست شبیه‌سازی شده بود؛ فایل‌های
واحد (`deploy/vps/*.service`، `*.timer`) همان‌اند که روی سرور نصب می‌شوند.
