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

type Provider = 'gemini' | 'openai' | 'anthropic';
interface Turn { role: 'user' | 'model'; text: string }

const DEFAULT_MODEL: Record<Provider, string> = {
  // 2.5-flash is closed to new Google accounts; 3.8-flash is the model Google itself points new keys to.
  gemini: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022',
};
const ENV_KEY: Record<Provider, string | undefined> = {
  gemini: process.env.GEMINI_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
};

class AiError extends Error {
  constructor(public code: string, public detail = '', public status = 502) {
    super(code);
  }
}

const TIMEOUT_MS = 22_000;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal, cache: 'no-store' });
  } catch (e) {
    throw new AiError((e as Error).name === 'AbortError' ? 'timeout' : 'network', (e as Error).message.slice(0, 120));
  } finally {
    clearTimeout(timer);
  }
}

async function errDetail(r: Response, model: string): Promise<string> {
  try {
    const j = (await r.json()) as { error?: { message?: string; status?: string; type?: string } | string };
    const e = j.error;
    const msg = typeof e === 'string' ? e : `${e?.status ?? e?.type ?? r.status}: ${e?.message ?? ''}`;
    return `${model} → ${msg}`.slice(0, 300);
  } catch {
    return `${model} → ${r.status}`;
  }
}

/** One call to the chosen provider, no model loop (a loop is what ran into the platform timeout). Returns the raw text. */
async function callProvider(provider: Provider, key: string, model: string, system: string, turns: Turn[]): Promise<string> {
  if (provider === 'gemini') {
    const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json', maxOutputTokens: 1200 },
    });
    if (r.status === 429) throw new AiError('quota', await errDetail(r, model), 429);
    if (!r.ok) {
      const d = await errDetail(r, model);
      throw new AiError(/API key|API_KEY|PERMISSION_DENIED/i.test(d) ? 'key-rejected' : r.status === 404 ? 'model-not-found' : `http-${r.status}`, d, r.status === 400 || r.status === 404 ? 400 : 502);
    }
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }
  if (provider === 'openai') {
    const r = await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, {
      model,
      temperature: 0.4,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text }))],
    });
    if (r.status === 429) throw new AiError('quota', await errDetail(r, model), 429);
    if (r.status === 401) throw new AiError('key-rejected', await errDetail(r, model), 400);
    if (!r.ok) throw new AiError(r.status === 404 ? 'model-not-found' : `http-${r.status}`, await errDetail(r, model), r.status === 404 ? 400 : 502);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }
  const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
    model,
    max_tokens: 1200,
    temperature: 0.4,
    system,
    messages: turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
  });
  if (r.status === 429) throw new AiError('quota', await errDetail(r, model), 429);
  if (r.status === 401 || r.status === 403) throw new AiError('key-rejected', await errDetail(r, model), 400);
  if (!r.ok) throw new AiError(r.status === 404 ? 'model-not-found' : `http-${r.status}`, await errDetail(r, model), r.status === 404 ? 400 : 502);
  const j = (await r.json()) as { content?: { type: string; text?: string }[] };
  return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

/** Models without a JSON mode may wrap the answer in text or fences: take the outermost {...}. */
function parseJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

/** POST { prompt, context?, history?, mode?, provider?, key?, model? } with the Supabase access token. Only signed-in users can use it. */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !(await verify(token))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { prompt?: unknown; context?: unknown; history?: unknown; mode?: unknown; provider?: unknown; key?: unknown; apiKey?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : '';
  if (!prompt) return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 });

  const provider: Provider = body.provider === 'openai' || body.provider === 'anthropic' ? body.provider : 'gemini';
  // Pasted keys often carry spaces, quotes or line breaks. The key typed in the app wins over the server variable.
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/["'\s]/g, '') : '');
  const typed = clean(body.apiKey ?? body.key);
  const apiKey = /^[\x21-\x7e]{20,300}$/.test(typed) ? typed : clean(ENV_KEY[provider]);
  if (!apiKey) return NextResponse.json({ ok: false, error: 'no-key', provider }, { status: 400 });
  const customModel = typeof body.model === 'string' && /^[A-Za-z0-9._:-]{3,80}$/.test(body.model.trim()) ? body.model.trim() : '';
  const model = customModel || DEFAULT_MODEL[provider];

  const classify = body.mode === 'classify';
  const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : '';
  const hist = (Array.isArray(body.history) ? (body.history as { role?: string; text?: string }[]) : []).slice(-8)
    .filter((h) => typeof h?.text === 'string' && (h.role === 'user' || h.role === 'model'))
    .map((h) => ({ role: h.role as 'user' | 'model', text: String(h.text).slice(0, 1500) }));
  // Anthropic needs the first turn to be the user's and strictly alternating roles.
  const turns: Turn[] = [];
  for (const h of hist) if (turns.length > 0 ? turns[turns.length - 1].role !== h.role : h.role === 'user') turns.push(h);
  if (turns.length > 0 && turns[turns.length - 1].role === 'user') turns.pop();
  turns.push({ role: 'user', text: classify ? prompt : `CONTEXT:\n${context}\n\nطلب المستخدم:\n${prompt}` });

  try {
    const text = await callProvider(provider, apiKey, model, classify ? CLASSIFY : SYSTEM, turns);
    if (!text) throw new AiError('empty', `${model} → empty answer`);
    const parsed = parseJson(text) ?? (classify ? null : { reply: text, actions: [] });
    return NextResponse.json({ ok: true, provider, model, data: parsed });
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ ok: false, error: e.code, provider, detail: e.detail }, { status: e.status });
    return NextResponse.json({ ok: false, error: 'unavailable', provider, detail: (e as Error).message.slice(0, 160) }, { status: 502 });
  }
}
