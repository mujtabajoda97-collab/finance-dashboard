import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_PROMPT = 2000;
const MAX_CONTEXT = 24_000;
// "gemini-1.5-flash" has been retired by Google; it is tried last so the first model that answers is used.
const MODELS = [process.env.GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'].filter(Boolean) as string[];

const SYSTEM = `أنت «المساعد الذكي» داخل تطبيق «نظام إدارة حياتي» الخاص بمستخدم واحد في دبي. تجيب بالعربية بأسلوب ودّي ومختصر (ما لم يكتب المستخدم بالإنجليزية).
تستند فقط إلى البيانات المرفقة في CONTEXT (هي بيانات المستخدم الحالي وحده). لا تخترع أرقاماً أو أسماء غير موجودة؛ إن لم تكفِ البيانات فاذكر ذلك.
أعد دائماً JSON فقط بالشكل:
{"reply":"نص الرد للمستخدم","actions":[...]}
قواعد actions (اتركها [] إلا إذا طلب المستخدم صراحةً تسجيل شيء):
- مصروف: {"type":"expense","amount":150,"wallet":"اسم محفظة من CONTEXT","category":"GROCERIES","notes":"البقالة"}
- دخل: {"type":"income","amount":..,"wallet":"..","category":"SALARY|PROJECT|GENERAL","notes":".."}
- سداد دين: {"type":"debt_payment","person":"اسم الشخص كما في الديون","amount":500,"wallet":"اسم المحفظة"}
فئات المصروف المسموحة: GENERAL, FOOD, GROCERIES, TRANSPORT, BILLS, RENT, PERSONAL, SHOPPING, HEALTH.
اختر محفظة من قائمة المحافظ بنفس عملة العملية؛ «كاش» تعني محفظة اسمها يحتوي كاش/نقد إن وُجدت. إن كان الاختيار غامضاً فاترك wallet فارغاً واطلب التوضيح في reply.
لا تنفّذ شيئاً بنفسك: التطبيق يعرض للمستخدم تأكيداً قبل أي تسجيل.
عند الطلب: حلّل الإنفاق وقارن الفترات (month vs prevMonth)، احسب عجز/فائض المشاريع من projects، اكتب رسالة تحصيل ودّية للواتساب (نص جاهز في reply)، أو رتّب أولويات اليوم من tasks وdebts (ترتيب مرقّم مع السبب).`;

const CLASSIFY = `حلّل رد مدين على رسالة تذكير بدين. أعد JSON فقط:
{"category":"EXTENSION|POSTPONE|APOLOGY|PAID_CLAIM|OTHER","summary":"ملخص بجملة","suggest_days":عدد_أيام_اقتراح_التأجيل_أو_null,"suggested_reply":"رد ودّي مقترح"}
EXTENSION=طلب مهلة، POSTPONE=تأجيل لتاريخ، APOLOGY=اعتذار، PAID_CLAIM=يقول إنه سدّد.`;

async function verify(token: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` }, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

/** POST { prompt, context?, history?, mode?, key? } with the Supabase access token. Only signed-in users can use it. */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !(await verify(token))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { prompt?: unknown; context?: unknown; history?: unknown; mode?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : '';
  if (!prompt) return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 });
  const own = typeof body.key === 'string' ? body.key.trim() : '';
  const apiKey = /^[A-Za-z0-9_-]{20,80}$/.test(own) ? own : process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) return NextResponse.json({ ok: false, error: 'no-key' }, { status: 400 });

  const classify = body.mode === 'classify';
  const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : '';
  const hist = Array.isArray(body.history) ? (body.history as { role?: string; text?: string }[]).slice(-8) : [];
  const contents = [
    ...hist
      .filter((h) => typeof h?.text === 'string' && (h.role === 'user' || h.role === 'model'))
      .map((h) => ({ role: h.role as string, parts: [{ text: String(h.text).slice(0, 1500) }] })),
    { role: 'user', parts: [{ text: classify ? prompt : `CONTEXT:\n${context}\n\nطلب المستخدم:\n${prompt}` }] },
  ];

  let lastErr = 'unavailable';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: classify ? CLASSIFY : SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json', maxOutputTokens: 1500 },
        }),
        cache: 'no-store',
      });
      if (r.status === 404) { lastErr = 'model-not-found'; continue; }
      if (r.status === 400 || r.status === 403) return NextResponse.json({ ok: false, error: 'key-rejected' }, { status: 400 });
      if (r.status === 429) return NextResponse.json({ ok: false, error: 'quota' }, { status: 429 });
      if (!r.ok) { lastErr = `gemini-${r.status}`; continue; }
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = classify ? null : { reply: text, actions: [] };
      }
      return NextResponse.json({ ok: true, model, data: parsed });
    } catch {
      lastErr = 'network';
    }
  }
  return NextResponse.json({ ok: false, error: lastErr }, { status: 502 });
}
