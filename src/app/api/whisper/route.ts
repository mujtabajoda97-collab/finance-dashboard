import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 4_000_000; // Vercel rejects request bodies above ~4.5 MB.
const HINT = 'مصروف، دخل، سداد دين، درهم، دينار، دولار، كاش، بنك، البقالة، مهمة، أرسل رسالة واتساب، اتصل بـ';

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
const bearer = (req: Request) => {
  const a = req.headers.get('authorization') ?? '';
  return a.startsWith('Bearer ') ? a.slice(7).trim() : '';
};

/** GET: does the server have its own OpenAI key? (lets the app decide between Whisper and the phone's recognizer) */
export async function GET(req: Request) {
  const t = bearer(req);
  if (!t || !(await verify(t))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, serverKey: !!process.env.OPENAI_API_KEY });
}

/** POST multipart { audio, lang?, apiKey? } -> { ok, text }. Only signed-in users; the typed key wins over OPENAI_API_KEY. */
export async function POST(req: Request) {
  const t = bearer(req);
  if (!t || !(await verify(t))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'too-large' }, { status: 413 });

  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/["'\s]/g, '') : '');
  const typed = clean(form.get('apiKey'));
  const apiKey = /^[\x21-\x7e]{20,300}$/.test(typed) ? typed : clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return NextResponse.json({ ok: false, error: 'no-key' }, { status: 400 });

  const lang = form.get('lang') === 'en' ? 'en' : 'ar';
  const name = audio instanceof File && audio.name ? audio.name : 'speech.webm';
  const out = new FormData();
  out.append('file', audio, name);
  out.append('model', 'whisper-1');
  out.append('language', lang);
  out.append('response_format', 'json');
  out.append('temperature', '0');
  if (lang === 'ar') out.append('prompt', HINT);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: out, signal: ctl.signal });
    if (!r.ok) {
      let detail = '';
      try { detail = (((await r.json()) as { error?: { message?: string } }).error?.message ?? '').slice(0, 200); } catch { /* ignore */ }
      const error = r.status === 401 ? 'key-rejected' : r.status === 429 ? 'quota' : `http-${r.status}`;
      return NextResponse.json({ ok: false, error, detail }, { status: r.status === 401 || r.status === 429 ? 400 : 502 });
    }
    const j = (await r.json()) as { text?: string };
    return NextResponse.json({ ok: true, text: (j.text ?? '').trim() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).name === 'AbortError' ? 'timeout' : 'unavailable' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
