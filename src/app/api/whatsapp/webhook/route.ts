import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Green API incoming-message webhook.
 *  - Set the instance "webhookUrl" to  https://<site>/api/whatsapp/webhook/  and "webhookUrlToken" to GREEN_WEBHOOK_TOKEN.
 *  - Needs env: GREEN_WEBHOOK_TOKEN, SUPABASE_SERVICE_ROLE_KEY (+ the public Supabase URL). GEMINI_API_KEY is optional (classification).
 * Matching is done through wa_outbox (SQL 0011): the sender must be a number the app itself wrote to.
 */
const DONE = /^\s*(تم|تمام|نعم|ايوه|أيوه|اي|done|yes|ok|okay)\s*[.!۔]*\s*$/i;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const svc = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const H = () => ({ apikey: svc(), authorization: `Bearer ${svc()}`, 'content-type': 'application/json' });

async function rest<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(`${url()}/rest/v1/${path}`, { ...init, headers: { ...H(), ...(init?.headers ?? {}) }, cache: 'no-store' });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? (JSON.parse(t) as T) : (null as T);
  } catch {
    return null;
  }
}

async function classify(text: string): Promise<{ category: string; summary: string; suggest_days: number | null; suggested_reply: string }> {
  const fallback = (): { category: string; summary: string; suggest_days: number | null; suggested_reply: string } => {
    const t = text;
    let category = 'OTHER';
    if (/(مهلة|امهلني|أمهلني|اصبر|معلش|لحد|لين)/.test(t)) category = 'EXTENSION';
    else if (/(بكرة|بكره|اسبوع|أسبوع|الشهر|بعد|تأجيل|أجل)/.test(t)) category = 'POSTPONE';
    else if (/(آسف|اسف|عذر|سامح|معذرة)/.test(t)) category = 'APOLOGY';
    else if (/(حولت|سددت|دفعت|ارسلت|أرسلت)/.test(t)) category = 'PAID_CLAIM';
    return { category, summary: t.slice(0, 120), suggest_days: category === 'EXTENSION' || category === 'POSTPONE' ? 7 : null, suggested_reply: 'الله يسهّل أمرك، أخبرني متى يناسبك وجزاك الله خيراً.' };
  };
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallback();
  for (const model of [process.env.GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-2.5-flash'].filter(Boolean) as string[]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: 'حلّل رد مدين على تذكير بدين. أعد JSON فقط: {"category":"EXTENSION|POSTPONE|APOLOGY|PAID_CLAIM|OTHER","summary":"جملة","suggest_days":رقم_أو_null,"suggested_reply":"رد ودّي قصير"}' }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 400 },
        }),
        cache: 'no-store',
      });
      if (r.status === 404) continue;
      if (!r.ok) break;
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const p = JSON.parse(j.candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('') ?? '{}');
      if (p && typeof p.category === 'string') {
        return {
          category: ['EXTENSION', 'POSTPONE', 'APOLOGY', 'PAID_CLAIM', 'OTHER'].includes(p.category) ? p.category : 'OTHER',
          summary: String(p.summary ?? '').slice(0, 300),
          suggest_days: Number.isFinite(Number(p.suggest_days)) && Number(p.suggest_days) > 0 ? Math.min(90, Math.round(Number(p.suggest_days))) : null,
          suggested_reply: String(p.suggested_reply ?? '').slice(0, 500),
        };
      }
    } catch {
      break;
    }
  }
  return fallback();
}

async function reply(userId: string, to: string, message: string) {
  const prof = await rest<{ green_api_id_instance: string | null; green_api_token_instance: string | null }[]>(
    `profiles?select=green_api_id_instance,green_api_token_instance&id=eq.${userId}&limit=1`,
  );
  const inst = (prof?.[0]?.green_api_id_instance ?? '').trim();
  const tok = (prof?.[0]?.green_api_token_instance ?? '').trim();
  if (!/^\d{4,15}$/.test(inst) || !/^[A-Za-z0-9]{16,128}$/.test(tok)) return;
  try {
    await fetch(`https://${inst.slice(0, 4)}.api.greenapi.com/waInstance${inst}/sendMessage/${tok}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: `${to}@c.us`, message }),
      cache: 'no-store',
    });
  } catch {
    /* ignore */
  }
}

export async function POST(req: Request) {
  const expected = process.env.GREEN_WEBHOOK_TOKEN ?? '';
  if (!expected || !svc() || !url()) return NextResponse.json({ ok: false, error: 'not-configured' }, { status: 503 });
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (got !== expected) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (body?.typeWebhook !== 'incomingMessageReceived') return NextResponse.json({ ok: true, ignored: true });
  const md = body.messageData;
  const text: string = (md?.textMessageData?.textMessage ?? md?.extendedTextMessageData?.text ?? '').toString().trim().slice(0, 1000);
  const sender: string = String(body.senderData?.sender ?? body.senderData?.chatId ?? '').replace(/@.*/, '').replace(/\D/g, '');
  const msgId: string = String(body.idMessage ?? '');
  if (!text || !/^\d{8,15}$/.test(sender)) return NextResponse.json({ ok: true, ignored: true });

  // The newest message the app sent to this number tells us whose reply it is and what it was about.
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const last = await rest<{ user_id: string; kind: 'task' | 'debt'; ref_ids: string[]; is_own_number: boolean }[]>(
    `wa_outbox?select=user_id,kind,ref_ids,is_own_number&chat_phone=eq.${sender}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`,
  );
  const m = last?.[0];
  if (!m) return NextResponse.json({ ok: true, matched: false });

  if (m.kind === 'task') {
    if (!DONE.test(text)) return NextResponse.json({ ok: true, matched: true, action: 'none' });
    const ids = m.ref_ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (ids.length === 0) return NextResponse.json({ ok: true });
    const done = await rest<{ title: string }[]>(
      `tasks?id=in.(${ids.join(',')})&user_id=eq.${m.user_id}&is_completed=eq.false&select=title`,
      { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ is_completed: true }) },
    );
    if (done && done.length > 0) await reply(m.user_id, sender, `✅ تم تسجيل الإنجاز:\n${done.map((t) => `• ${t.title}`).join('\n')}`);
    return NextResponse.json({ ok: true, completed: done?.length ?? 0 });
  }

  // kind === 'debt': a reply from the debtor (replies from the owner's own number are not debtor replies).
  if (m.is_own_number) return NextResponse.json({ ok: true, ignored: true });
  const debtId = m.ref_ids[0];
  if (!debtId || !/^[0-9a-f-]{36}$/i.test(debtId)) return NextResponse.json({ ok: true });
  const c = await classify(text);
  await rest('wa_inbox', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: m.user_id, debt_id: debtId, msg_id: msgId || null, from_phone: sender, body: text, ...c }),
  });
  return NextResponse.json({ ok: true, stored: true, category: c.category });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'whatsapp-webhook' });
}
