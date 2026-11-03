import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_PROMPT = 2000;
const MAX_CONTEXT = 24_000;

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
  // The key typed in the app wins over the server variable. Pasted keys often carry spaces, quotes or line breaks.
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/["'\s]/g, '') : '');
  const own = clean(body.key);
  const apiKey = /^[\x21-\x7e]{20,200}$/.test(own) ? own : clean(process.env.GEMINI_API_KEY);
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

  const started = Date.now();
  const left = () => 24_000 - (Date.now() - started);
  const gem = async (path: string, init: RequestInit | undefined, ms: number) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/${path}`, {
        ...init,
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const errOf = async (r: Response) => {
    try {
      const j = (await r.json()) as { error?: { message?: string; status?: string } };
      return `${j.error?.status ?? r.status}: ${(j.error?.message ?? '').slice(0, 220)}`;
    } catch {
      return String(r.status);
    }
  };

  // Fast path: go straight to a known fast model (no discovery round-trip). Only when every one of them is
  // unavailable (404) is the key's own model list asked for, within the remaining time budget.
  const tried = new Set<string>();
  let candidates = [process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'].filter(Boolean) as string[];
  let lastErr = 'unavailable';
  let detail = '';
  let discovered = false;

  while (candidates.length > 0 && left() > 2_000) {
    const model = candidates.shift() as string;
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      const r = await gem(
        `models/${model}:generateContent`,
        {
          method: 'POST',
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: classify ? CLASSIFY : SYSTEM }] },
            contents,
            generationConfig: {
              temperature: 0.4,
              responseMimeType: 'application/json',
              maxOutputTokens: 1200,
              // 2.5 models "think" first, which costs seconds: switch it off for quick answers.
              ...(/2\.5-flash/.test(model) && !/lite/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
          }),
        },
        Math.min(12_000, left()),
      );
      if (r.status === 429) return NextResponse.json({ ok: false, error: 'quota', detail: await errOf(r) }, { status: 429 });
      if (!r.ok) {
        detail = `${model} → ${await errOf(r)}`;
        if (/API_KEY|API key not valid|PERMISSION_DENIED/i.test(detail)) return NextResponse.json({ ok: false, error: 'key-rejected', detail }, { status: 400 });
        lastErr = `gemini-${r.status}`;
      } else {
        const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } };
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        if (text) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          } catch {
            parsed = classify ? null : { reply: text, actions: [] };
          }
          return NextResponse.json({ ok: true, model, data: parsed });
        }
        detail = `${model} → empty (${j.promptFeedback?.blockReason ?? 'no text'})`;
        lastErr = 'empty';
      }
    } catch (e) {
      lastErr = (e as Error).name === 'AbortError' ? 'timeout' : 'network';
      detail = `${model} → ${lastErr}`;
    }
    if (candidates.length === 0 && !discovered && lastErr.startsWith('gemini-4') && left() > 5_000) {
      discovered = true;
      try {
        const lr = await gem('models?pageSize=100', undefined, 4_000);
        if (lr.ok) {
          const lj = (await lr.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
          candidates = (lj.models ?? [])
            .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent') && /flash/.test(m.name) && !/(image|tts|live|audio|thinking|exp|preview)/.test(m.name))
            .map((m) => m.name.replace(/^models\//, ''))
            .filter((m) => !tried.has(m))
            .slice(0, 2);
        }
      } catch {
        /* keep the last error */
      }
    }
  }
  return NextResponse.json({ ok: false, error: lastErr, detail }, { status: 502 });
}
