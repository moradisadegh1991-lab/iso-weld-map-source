# مرجع EPC پتروشیمی و پالایشگاه — فازها، مدارک، تحویل، استانداردها

صفحه در پلتفرم: **پروژه ◄ مرجع EPC** (`/reference`؛ داده در `lib/reference/epc.mjs`).

## روش و حدود این تحقیق
راهنمای رویهٔ رایج صنعت است، نه متن هیچ قرارداد یا استانداردی. جستجوی وب برای متن کامل NORSOK Z-007،
بندهای FIDIC و فهرست رسمی IPS نتیجهٔ مستقیم نداد؛ آنچه آمده از منابع زیر و دانش عمومی صنعت است و باید با
**قرارداد، مشخصات فنی و فهرست استانداردهای خود پروژه** تطبیق داده شود. ویرایش هیچ استانداردی فرض نشده —
ویرایش در «رجیستر استانداردهای پروژه» ثبت می‌شود و تا ثبت نشده در «اطلاعات ناقص» می‌آید.

## خلاصهٔ یافته‌ها
1. **فازها:** FEL1 (امکان‌سنجی) ← FEL2 (طراحی پایه/Pre-FEED) ← FEL3 (FEED، پایهٔ مناقصهٔ EPC) ← مهندسی تفصیلی
   (IFR→IFA→IFC) ← تأمین (MR→PO→FAT→حمل→رسید) ← اجرا ← تکمیل مکانیکی ← پیش‌راه‌اندازی ← راه‌اندازی ←
   راه‌اندازی اولیه و آزمون عملکرد ← دورهٔ تضمین.
2. **دروازه‌ها و گواهی‌ها:** MCC هر ساب‌سیستم (بدون پانچ A)، RFC، RFSU، PAC/Taking-Over (پس از آزمون عملکرد؛
   پانچ باقی‌مانده با فهرست)، FAC/Performance Certificate (پایان دورهٔ اعلام نقص — معمولاً یک سال، طبق شرایط خصوصی).
3. **پیش‌راه‌اندازی** پس از MC: فلاشینگ، خشک‌کردن، کالیبراسیون PSV و ابزار، لوپ چک — و پیش‌نیاز آن گواهی MC است.
4. **پانچ:** A پیش از تحویل بسته شود، B در راه‌اندازی، C بعدتر (تعریف دقیق با روال پانچ پروژه).
5. **دادهٔ تحویل:** CFIHOS (IOGP، الگوهای اکسل «اطلاعات ضروری»)، ISO 15926 (چارچوب گسترده‌تر)، ISO 14224 (دادهٔ نگهداری).
6. **ایران:** IPS پایهٔ مشخصات پروژه‌های وزارت نفت است و با «الحاقیهٔ» هر پروژه مشخصات فنی کار را می‌سازد؛ حدوداً هر پنج سال بازنگری می‌شود.

## در پلتفرم
| موضوع | کجا |
|---|---|
| فازها با دروازه و لینک به ماژول هر فاز | `/reference` — «فازها و دروازه‌ها» |
| مدارک هر رشته، فاز صدور، و آنچه خواندن مدارک از هرکدام برمی‌دارد | «مدارک هر رشته» (پیوند به `/documents/intake`) |
| شرط هر گواهی و موتوری که امضا را تا برقراری آن رد می‌کند | «گواهی‌های تحویل» |
| ۸ چک‌لیست ITR-B و راه‌اندازی، قابل پذیرش در `/precom` (نسخهٔ پروژه بازنویسی نمی‌شود) | «چک‌لیست‌های تحویل» |
| استانداردهای رایج با موتور مرتبط در پلتفرم + رجیستر استانداردهای پروژه با ویرایش | «استانداردها» (`064_project_standards.sql`) |

## هنوز ساخته نشده (از همین مرجع)
- گواهی **PAC** و **FAC** به‌عنوان رکورد امضاشده (آزمون عملکرد هست).
- برگه‌های **ITR-A** به تفکیک رشته (MC فعلاً از رکوردها حساب می‌شود).
- دفترچهٔ تحویل سیستم (System Handover Dossier) به‌صورت خروجی یکجا.
- خروجی داده با ساختار **CFIHOS**.

## منابع
- [NORSOK Z-007 — standard.no (بازنگری و نظرخواهی)](https://standard.no/en/news/norsok-standard-for-mechanical-completion-and-commissioning-is-revised-and-on-public-enquiry)
- [Phases of an oil & gas project — whatispiping.com](https://whatispiping.com/phases-of-a-project/) · [FEED vs detailed engineering](https://whatispiping.com/front-end-engineering-design-feed/)
- [FIDIC 2017 taking-over — Fenwick Elliott](https://www.fenwickelliott.com/research-insight/newsletters/international-quarterly/taking-over-completion-fidic) · [Contractual liabilities post completion (PDF)](https://www.fenwickelliott.com/sites/default/files/fenwick_elliott_-_contractual_liabilities_post_completion.pdf) · [Remedies for construction defects](https://www.worldconstructionnetwork.com/analysis/remedies-for-construction-defects/)
- [CFIHOS / ISO 15926 — Oil IT Journal](https://oilit.com/HTML_Articles/2021_1_6.php) · [Hexagon: CFIHOS](https://hexagonppm.com/about/compliance/cfihos)
- [Pre-commissioning checklists (Kissflow)](https://kissflow.com/appstore/pre-commissioning-checklists-software) · [Mechanical completion clauses](https://www.lawinsider.com/clause/mechanical-completion)
- IPS: معرفی در مقدمهٔ استانداردهای منتشرشده (نمونه: IPS-E-AR-160)؛ فهرست رسمی را از مرجع وزارت نفت بگیرید.
