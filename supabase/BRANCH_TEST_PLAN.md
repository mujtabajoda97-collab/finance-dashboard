# خطة اختبار Migration 0003 على بيئة Supabase حقيقية محلية (الخيار B) — غير منفَّذة، بانتظار الموافقة

> الحالة: موافقة مبدئية على الاتجاه (Supabase CLI + Docker). **لا موافقة بعد على التنفيذ ولا على تطبيق أي Migration.**
> لا يُنشأ Branch. لا يُمَسّ المشروع الأساسي `rhsqratwipnyhldxdqyo` ولا Vercel ولا Production.

## الهدف
إثبات أن 0003 يعمل على **PostgreSQL 17** مع **PostgREST وGoTrue الحقيقيين** (صور Supabase الرسمية محلياً)، وأن ضمانات الأمان والأرصدة وسداد الديون متعددة العملات تصمد عبر طلبات HTTP فعلية، قبل أي تطبيق على الأساسي.

## 1) المتطلبات (ما تحقّقتُ منه وما لم أتحقق)
| البند | المطلوب | الحالة |
|---|---|---|
| حاوية | Docker Desktop (ويندوز/لينكس) أو OrbStack/Colima/Rancher/Podman (ماك) — أي بيئة متوافقة مع Docker تعمل | مؤكَّد من توثيق Supabase: الأنواع المدعومة. التوثيق **لا يحدد رقم إصدار** أدنى. توصيتي (غير مؤكدة رسمياً): Docker Engine/Desktop 24 أو أحدث |
| Node.js | 20 أو أحدث | مؤكَّد من التوثيق (16 غير مدعوم) |
| Supabase CLI | يُثبَّت محلياً كاعتماد مثبّت الإصدار داخل مجلد الاختبار (`npm i -D supabase@<الإصدار>`) | صفحة الإصدارات تُظهر وقت الفحص فقط نسخاً تجريبية `v3.0.0-beta.15…17` (30 أكتوبر 2026). **لم أستطع تأكيد آخر إصدار مستقر.** عند التجهيز يُحدَّد بـ `npm view supabase dist-tags` ويُثبَّت إصدار مستقر بالرقم الكامل، **بدون beta**، ويُسجَّل في `package-lock.json` وفي تقرير النتائج |
| الذاكرة | التوثيق يوصي بـ **7 GB RAM** على الأقل لتشغيل كل الخدمات | مؤكَّد. سأعطّل الخدمات غير اللازمة (Studio، Realtime، Storage، Edge Runtime، Analytics/Vector، imgproxy) فتنخفض الحاجة؛ تقديري 3–4 GB وهو **غير مقيس** |
| القرص | التوثيق لا يحدد. تقديري لتنزيل صور Docker الأولى 3–6 GB وبعدها بضع مئات MB للبيانات | **غير مؤكد** — يُقاس عند أول تشغيل ويُدرج في التقرير |
| المنافذ | 54321 (API) و54322 (DB) و54324 (البريد) | مؤكَّدة افتراضياً؛ Studio (54323) معطّل |
| الإنترنت | لتنزيل الصور مرة واحدة فقط | — |

**هل Docker موجود على جهازك؟** لا أعرف. جهازك غير متصل بجلستي الآن (حاولتُ فحصاً للقراءة فقط وفشل الاتصال)، فلم أتحقق. افحصه بنفسك بهذه الأوامر (قراءة فقط):
```
docker --version
docker info --format "server={{.ServerVersion}} cpus={{.NCPU}} mem={{.MemTotal}}"
node --version
```
إن لم يُثبَّت Docker فالتثبيت يحتاج منك (Docker Desktop أو OrbStack)؛ لن أثبّت شيئاً على جهازك.

## 2) ما سأجهّزه بعد موافقتك (مجلد معزول `local-test/`، خارج مجلد التطبيق)
| الملف | وظيفته |
|---|---|
| `local-test/package.json` + `package-lock.json` | يثبّت إصدار Supabase CLI بالرقم الكامل |
| `local-test/supabase/config.toml` | `project_id = "supabase-test-0003"`، `[db] major_version = 17`، تعطيل Studio/Realtime/Storage/Edge Runtime/Analytics، `[auth.email] enable_confirmations = false`، `[auth] enable_signup = true` (محلياً فقط) |
| `local-test/scripts/preflight.sh` | حواجز العزل (القسم 3) + فحص Docker/المنافذ/الذاكرة؛ يفشل قبل أي تشغيل |
| `local-test/scripts/up.sh` | `supabase start`، ثم يطبّق `0001_init.sql` و`0002_cron.sql` (نسخة قراءة من المستودع) على 127.0.0.1:54322 |
| `local-test/scripts/apply.sh` | يطبّق 0003 (مرتين للتحقق من idempotency)، ثم 0004 اختيارياً في تشغيل منفصل |
| `local-test/scripts/catalog.sh` | يشغّل `supabase/tests/catalog_expect_0003.sql` وبصمة الكتالوج ويحفظ النتائج |
| `local-test/tests/run.mjs` | اختبارات HTTP (القسم 4) بالمفتاح العام فقط |
| `local-test/scripts/rollback_rehearsal.sh` | بروفة `rollback/0003_rollback.sql` (مع سطر CONFIRM) ثم إعادة التطبيق |
| `local-test/scripts/down.sh` | الإيقاف والحذف (القسم 6) |
ملفات SQL تُنسخ من المستودع للقراءة ولا تُعدَّل.

## 3) كيف أضمن أن الاختبار لا يتصل بالمشروع الأساسي، وأن كل شيء اختباري
`preflight.sh` و`run.mjs` يرفضان العمل (خروج برمز خطأ قبل أي طلب) في أي من هذه الحالات:
1. وجود `supabase/.temp/project-ref` أو `pooler-url` في مجلد الاختبار (أثر `supabase link`)، أو متغيرات `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` في البيئة.
2. أي ملف داخل `local-test/` يحتوي `rhsqratwipnyhldxdqyo` أو `qdicurevkwntgqhmrzim` (المشروع الآخر) أو `.supabase.co` أو `sb_secret_`.
3. اسم أي متغير بيئة يحتوي `SERVICE` أو `SECRET`، أو مفتاح يُفك JWT فيه إلى `role: service_role`.
4. كون `BASE_URL` ليس `http://127.0.0.1:54321` أو `http://localhost:54321` (المضيف مقارَن حرفياً، لا يُقبل `supabase.co` مطلقاً)، أو اتصال DB ليس على 127.0.0.1:54322.
5. وجود أي صف في جداول `public` قبل البدء (يجب أن تبدأ فارغة)، أو أي بريد/اسم لا يبدأ بـ `TEST_` / لا ينتهي بـ `@example.test` أثناء التشغيل.

**المفاتيح:** المفتاح الوحيد الذي يقرؤه السكربت هو `ANON_KEY` المحلي من `supabase status -o env`، وبقائمة بيضاء بالاسم؛ باقي مخرجات الأمر (ومنها مفتاح الخدمة المحلي) لا تُقرأ ولا تُطبع. هذه مفاتيح تطوير محلية موقَّعة بسر المنصة المحلي العام، لا تعمل على أي مشروع مستضاف. لا مفاتيح في Git ولا في سجل النتائج. المستخدمان الاختباريان (`test_a@example.test`, `test_b@example.test`) يُنشآن عبر `signUp` بالمفتاح العام ويُحذفان مع حذف الحجوم.
ما يحتاج صلاحية أعلى (فحص `wallet_reconciliation` والكتالوج والتراجع) يُنفَّذ بـ `psql` على قاعدة المحلية فقط.

## 4) خطوات الاختبار
| # | الخطوة | معيار النجاح |
|---|---|---|
| 0 | `preflight.sh` | كل الحواجز تمر |
| 1 | `up.sh`: `supabase start` + 0001 + 0002 | `select version()` PostgreSQL 17؛ PostgREST وGoTrue يستجيبان |
| 2 | بصمة الكتالوج قبل 0003 ومقارنتها بالبصمة المسجَّلة من الأساسي (97 عموداً، 40 قيداً، 6 enums، 10 جداول/عروض RLS، 11 triggers، 13 سياسة) | الفئات الخمس الأولى متطابقة؛ الفروق المعروفة مسبقاً فقط: 5 فهارس FK إضافية في الأساسي، سياسة `remove own manual` مقابل `delete own manual`، و`search_path` على 4 دوال غير definer |
| 3 | `apply.sh`: 0003 ثم إعادته | بلا أخطاء في المرتين |
| 4 | **`catalog_expect_0003.sql`** | يتحقق من **الدوال الثماني كلها** (الاسم، الوسائط، SECURITY DEFINER/INVOKER، `search_path = public, pg_temp`، من يحق له EXECUTE): `transaction_validate`، `debt_payment_before_insert`، `debt_payment_after_insert`، `debt_before_update`، `wallet_currency_lock`، `month_summary`، `wallet_expected_balance`، `recompute_wallet_balances`. ثم 4 أعمدة، 4 فهارس، 5 triggers، `budgets` (RLS + سياسة)، `wallet_reconciliation` (security_invoker وبلا `anon`)، ولا دوال غير متوقعة (7 جديدة + `debt_payment_after_insert` مُستبدلة لا مضافة). ثم تعيين أن كل عنصر سابق ما زال بنفس بصمته |
| 5 | `notify pgrst, 'reload schema'` ثم مصفوفة الصلاحيات عبر REST: `anon` على كل جدول و`budgets` و`wallet_reconciliation` و`rpc/month_summary`؛ `authenticated` على `rpc/recompute_wallet_balances` و`rpc/debt_recalc` و`rpc/transaction_validate` | `anon` → 401/42501؛ `authenticated` → 404/42501 على الدوال الداخلية |
| 6 | مجموعة السلوك عبر REST بتوكن مستخدم حقيقي (المحفظة، الدخل/المصروف، التحويلات بما فيها تحويل لنفس المحفظة وتحويل السودان، تكرار `client_request_id` → 409/23505، تعديل `paid_amount` يدوياً يفشل، سدادان متزامنان)، واختبارات القيود الحقيقية: `debts_check`، `transactions_check`/`check1`، `ON DELETE RESTRICT`، `UNIQUE(debt_payment_id)`، ومنع العميل من تعديل/حذف معاملة مرتبطة بدفعة دين | مطابقة نتائج المجموعة المحلية |
| 7 | **سداد الديون متعدد العملات** (القسم 5) | كل الأرقام المذكورة تتحقق |
| 8 | بيانات `0003_ui_integration_seed.sql` نفسها عبر REST ثم `rpc/month_summary` | الدخل 5000، المصروف 310، السودان 800، الصافي 3890، العدد 4، انحراف `wallet_reconciliation` = 0 |
| 9 | عزل المستخدمين A/B | صفر صفوف / رفض |
| 10 | بروفة التراجع: تعطيل العلم أولاً (محاكاة)، ثم `rollback/0003_rollback.sql` مع سطر CONFIRM، تحقق (الحارس يرفض الدفعات متعددة العملات؛ المبالغ المسجلة سابقاً لا تتغير؛ 11/11 دالة محصّنة)، ثم إعادة تطبيق 0003 | تمر |
| 11 | `down.sh` والتحقق من الحذف | القسم 6 |

## 5) سداد الديون متعدد العملات (الخطوة 7)
القاعدة: `amount` = القسط **بعملة الدين** (يُنقص `paid_amount`)، و`wallet_amount` = ما يخرج من/يدخل إلى **المحفظة** بعملتها. فُحصت الحالات محلياً (مجموعة `tests/0003_debt_multicurrency.sql`، كلها ناجحة) وستُعاد عبر REST:

| السيناريو | المُدخل | يُخصم/يُضاف للمحفظة | يُسدَّد من الدين |
|---|---|---|---|
| دين SDG (عليّ 160,000) ومحفظة AED (1000) | `amount=16000`, `wallet_amount=100` | AED: 1000 → **900** (مصروف 100 AED، الأصل 16000 SDG، السعر 0.00625) | **16,000 SDG** → PARTIAL |
| القسط الثاني بسعر مختلف | `amount=32000`, `wallet_amount=210` | 900 → **690** (يُخصم 210 بالضبط، السعر المخزَّن 0.006563 مقرَّب لـ 6 خانات) | تراكمي **48,000 SDG** |
| تجاوز المتبقي | `amount=112000.01`, `wallet_amount=1` | لا تغيير | يُرفض: التجاوز يُقاس **بعملة الدين** |
| سداد المتبقي بالضبط | `amount=112000`, `wallet_amount=600` | 690 → 90 | **PAID** (160,000) |
| حذف آخر قسط | — | يعود **+600 AED** | يعود PARTIAL، 48,000 |
| دين AED (عليّ 1000) ومحفظة SDG (200,000) | `amount=100`, `wallet_amount=16000` | SDG: 200,000 → **184,000** (مصروف 16000 SDG، الأصل 100 AED، السعر 160) | **100 AED** → PARTIAL |
| دين AED لي (500) يُحصَّل في محفظة SDG | `amount=50`, `wallet_amount=8100` | SDG: 184,000 → **192,100** (دخل) | **50 AED** |
| حواجز | بلا `wallet_amount` (في الاتجاهين)؛ `wallet_amount = 0`؛ سالب؛ عملة واحدة مع `wallet_amount ≠ amount` | — | كلها تُرفض برسالة واضحة |
| عملة واحدة | `amount=10` على محفظة AED | يُخصم 10 ولا يُخزَّن سعر | 10 |
| ملخص الشهر | — | تقارير `month_summary` تُظهر فئة DEBT بعملة **المحفظة** (SDG 16000 خارج / 8100 داخل؛ AED 320 خارج) وتُستبعد من الدخل/المصروف في الواجهة | — |
بعد كل ذلك: انحراف `wallet_reconciliation` = 0.

## 6) الإيقاف وحذف بيانات الاختبار
```
npx supabase stop --no-backup --project-id supabase-test-0003   # يوقف الحاويات ويحذف حجوم البيانات
docker ps -a      --filter "label=com.supabase.cli.project=supabase-test-0003"   # يجب أن تكون فارغة
docker volume ls  --filter "label=com.supabase.cli.project=supabase-test-0003"   # يجب أن تكون فارغة
rm -rf local-test/                                                                # (اختياري) حذف المجلد
docker image prune -a   # (اختياري) استرجاع مساحة الصور؛ يمسح كل الصور غير المستخدمة على جهازك، فاقرأ التحذير
```
لا موارد سحابية تُنشأ ولا فواتير. التحقق يصلك في التقرير بنتائج الأوامر الفارغة.

## 7) قواعد القرار
- أي فشل في 3 أو 4 أو 5 أو 6 أو 7 أو 8 = **لا تطبيق** على الأساسي؛ يُصحَّح الملف وتُعاد الخطوات من 3.
- لا يُطبَّق 0003 على المشروع الأساسي إلا بعد تقرير النتائج وموافقتك الصريحة، ومع نسخة احتياطية قبلها.
- بعد التطبيق على الأساسي فقط: يُفعَّل `NEXT_PUBLIC_SCHEMA_V3=1` على Preview ثم يُختبر بحسابك.

## ما لا تغطيه هذه الخطة
- الأحمال العالية (جُرّب محلياً 12,000 صف فقط).
- الفروق بين استضافة Supabase السحابية وحاويات CLI المحلية (إعدادات الشبكة، Supavisor، النسخ الاحتياطية)، وبناء المخطط من `0001+0002` لا من تاريخ المشروع الحقيقي العشري.
- تكامل n8n/Telegram.
- الخيار A (Branch بعد ترقية Pro، 0.01344$/ساعة + 25$/شهر) مؤجَّل ولا يُنفَّذ.
