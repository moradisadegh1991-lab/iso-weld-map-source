# رلهٔ Gemini روی Vercel

سرور پلتفرم (مثلاً VPS در ایران) مستقیم به Gemini نمی‌رسد — گوگل می‌گوید «User location is not
supported». این رله یک تابع Vercel است بین سرور و گوگل:

```
سرور پلتفرم ──(x-relay-token)──▶ رله روی Vercel ──(x-goog-api-key)──▶ Gemini
```

- **کلید Gemini فقط روی Vercel است.** سرور پلتفرم فقط «توکن رله» را دارد که فقط همین رله را باز
  می‌کند.
- **فقط دو فراخوان رد می‌شود:** `models/<مدل>:generateContent` و `:streamGenerateContent` — نه
  بارگذاری فایل، نه مدیریت کلید، نه چیز دیگری از API گوگل. با `ALLOWED_MODELS` مدل‌ها را هم محدود
  کنید.
- **بی‌تنظیم، بسته:** بدون `GEMINI_API_KEY` و `RELAY_TOKEN` به همه پاسخ ۵۰۳ می‌دهد؛ توکن غلط ۴۰۱.
- بدنهٔ درخواست و پاسخ ذخیره یا لاگ نمی‌شود؛ پاسخ گوگل همان‌طور که می‌آید stream می‌شود.
- حساب توکن روی سرور پلتفرم نگه داشته می‌شود (جدول `llm_usage`)، نه اینجا.

## نصب (یک بار، از داشبورد Vercel)

1. Vercel → **Add New… → Project** → مخزن `iso-weld-map-source` را Import کنید.
2. **Root Directory** را `deploy/gemini-relay` بگذارید؛ Framework Preset: **Other**. دکمهٔ Build را
   دست نزنید (ساختنی ندارد).
3. **Environment Variables** (نوع Sensitive):
   - `GEMINI_API_KEY` — کلید Google AI Studio
   - `RELAY_TOKEN` — یک رشتهٔ تصادفی بلند؛ مثلاً خروجی `openssl rand -hex 32`
   - `ALLOWED_MODELS` (اختیاری) — مثلاً `gemini-3.8-flash,gemini-4-argon,gemini-3.5-flash-lite`
4. **Deploy**. نشانی پروژه را بردارید، مثلاً `https://epc-gemini-relay.vercel.app`.
5. اگر Deployment Protection روشن است، برای این پروژه خاموشش کنید (Settings → Deployment
   Protection) — رله خودش با توکن قفل است، و سرور نمی‌تواند از صفحهٔ ورود Vercel رد شود.

بی‌Vercel CLI هم می‌شود: `npx vercel deploy --prod` داخل همین پوشه.

## روی سرور پلتفرم (`/etc/epc/epc.env`)

```
LLM_PROVIDER=gemini
GEMINI_BASE_URL=https://epc-gemini-relay.vercel.app/v1beta
GEMINI_RELAY_TOKEN=<همان RELAY_TOKEN>
```

`GEMINI_API_KEY` اینجا لازم نیست (و اگر باشد، به رله فرستاده نمی‌شود). سپس `sudo epc restart` و
`sudo epc doctor`.

آزمون سریع از خود سرور:

```bash
curl -s -X POST -H "content-type: application/json" -H "x-relay-token: <RELAY_TOKEN>" \
  "https://epc-gemini-relay.vercel.app/v1beta/models/gemini-3.8-flash:generateContent" \
  -d '{"contents":[{"role":"user","parts":[{"text":"say ok"}]}]}'
```

## محدودیت‌ها

- **حجم درخواست:** سقف بدنهٔ تابع Vercel ۴٫۵ مگابایت است؛ پلتفرم تصویرهای هر پاس را به ۴ مگابایت
  محدود کرده (`MAX_IMAGE_BYTES` در `app/api/extract`)، پس از سقف رد نمی‌شود.
- **زمان:** `maxDuration` ۳۰۰ ثانیه است (طرح Hobby با Fluid compute همین را می‌دهد).
- **دسترسی از ایران:** دامنهٔ `*.vercel.app` گاهی از داخل ایران فیلتر است. اگر سرور به رله نرسید،
  یک دامنهٔ اختصاصی به همین پروژه وصل کنید و همان را در `GEMINI_BASE_URL` بگذارید.
- **منطقه:** `iad1` (آمریکا) — گوگل آنجا سرویس می‌دهد.

## آزمون

`db/test/llm.mjs`: رلهٔ بی‌کلید یا بی‌توکن ۵۰۳؛ توکن غلط یا بی‌توکن ۴۰۱ و گوگل صدا زده نمی‌شود؛
هر مسیری جز generateContent ۴۰۴؛ مدل خارج از `ALLOWED_MODELS` ۴۰۳؛ درخواست درست با کلید گوگل و
`alt=sse` می‌رود، توکن رله جلوتر نمی‌رود، و پاسخ و خطای گوگل عیناً برمی‌گردد. حذف بررسی توکن
آزمون را قرمز کرد.
