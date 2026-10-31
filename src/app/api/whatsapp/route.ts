import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT = 1000;

/** Digits only, country code included. Accepts +971…, 00971…, and UAE local 05XXXXXXXX. */
function digitsOf(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  if (d.length < 8 || d.length > 15 || d.startsWith('0')) return null;
  return d;
}

interface ProfileRow {
  whatsapp_phone: string | null;
  green_api_id_instance: string | null;
  green_api_token_instance: string | null;
}

/**
 * POST { text } with `Authorization: Bearer <supabase access token>`.
 * Uses the Green API instance, token and WhatsApp number saved in the CALLER'S OWN profile
 * (row-level security guarantees nobody can read or use another user's keys).
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!sbUrl || !sbKey) return NextResponse.json({ ok: false, error: 'supabase-not-configured' }, { status: 503 });

  let text = '';
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ ok: false, error: 'empty-text' }, { status: 400 });

  let row: ProfileRow | undefined;
  try {
    const r = await fetch(
      `${sbUrl}/rest/v1/profiles?select=whatsapp_phone,green_api_id_instance,green_api_token_instance&limit=1`,
      { headers: { apikey: sbKey, authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    if (r.status === 401 || r.status === 403) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    // 400 here usually means the new columns do not exist yet (SQL 0006 not applied).
    if (r.status === 400) return NextResponse.json({ ok: false, error: 'sql-not-applied' }, { status: 503 });
    if (!r.ok) return NextResponse.json({ ok: false, error: 'profile-lookup-failed' }, { status: 502 });
    row = ((await r.json()) as ProfileRow[])[0];
  } catch {
    return NextResponse.json({ ok: false, error: 'profile-lookup-failed' }, { status: 502 });
  }

  const instance = (row?.green_api_id_instance ?? '').trim();
  const apiToken = (row?.green_api_token_instance ?? '').trim();
  if (!instance || !apiToken) return NextResponse.json({ ok: false, error: 'green-not-configured' }, { status: 400 });
  // Strict shape checks: these values are placed inside a URL.
  if (!/^\d{4,15}$/.test(instance) || !/^[A-Za-z0-9]{16,128}$/.test(apiToken)) {
    return NextResponse.json({ ok: false, error: 'green-invalid-keys' }, { status: 400 });
  }
  const phone = row?.whatsapp_phone ? digitsOf(row.whatsapp_phone) : null;
  if (!phone) return NextResponse.json({ ok: false, error: 'no-phone' }, { status: 400 });

  const host = `https://${instance.slice(0, 4)}.api.greenapi.com`;
  try {
    const r = await fetch(`${host}/waInstance${instance}/sendMessage/${apiToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: `${phone}@c.us`, message: text }),
      cache: 'no-store',
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `greenapi-${r.status}` }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'greenapi-unreachable' }, { status: 502 });
  }
}
