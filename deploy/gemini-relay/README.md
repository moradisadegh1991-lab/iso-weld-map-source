# رلهٔ مستقل Gemini و Anthropic

رله روی سروری اجرا می‌شود که دسترسی مجاز به API ارائه‌دهنده دارد. کلید API روی همان میزبان نگهداری می‌شود. برنامهٔ اصلی تنها توکن رله را در هدر `x-relay-token` می‌فرستد.

روی میزبان رله، `RELAY_TOKEN` و دست‌کم یکی از `GEMINI_API_KEY` و `ANTHROPIC_API_KEY` را در محیط سرویس تعریف کنید. از ریشهٔ مخزن با Node.js 22 اجرا کنید.

```bash
PORT=8787 node tools/relay-local.mjs
```

سرویس روی `127.0.0.1:8787` گوش می‌دهد. روی میزبان رله، پراکسی HTTPS مانند Caddy را به این پورت متصل کنید. مسیرهای لازم `/v1beta/*` برای Gemini و `/v1/messages` برای Anthropic هستند.

در VPS پلتفرم:

```dotenv
GEMINI_BASE_URL=https://relay.example.com/v1beta
GEMINI_RELAY_TOKEN=<RELAY_TOKEN>
ANTHROPIC_BASE_URL=https://relay.example.com/v1
ANTHROPIC_RELAY_TOKEN=<RELAY_TOKEN>
```

فقط متغیرهای سرویس‌هایی را که به آن‌ها نیاز دارید تنظیم کنید. نام دامنهٔ نمونه را با نشانی واقعی رله جایگزین کنید.
