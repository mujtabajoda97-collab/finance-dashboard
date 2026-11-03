import { NextResponse } from 'next/server';
import { sweep } from '@/lib/waEscalate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Escalates important, unhandled WhatsApp replies to the emergency number saved in Settings.
 *  - The signed-in app calls it (Bearer = Supabase token): only that user's replies are checked.
 *  - An external scheduler (cron-job.org etc.) can call it with  Authorization: Bearer <GREEN_WEBHOOK_TOKEN | CRON_SECRET>  to check everyone.
 *  - The Green API webhook also runs the same check on every event it receives.
 */
async function handle(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const secrets = [process.env.GREEN_WEBHOOK_TOKEN, process.env.CRON_SECRET].filter(Boolean) as string[];
  if (secrets.includes(token)) return NextResponse.json({ ok: true, ...(await sweep()) });

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!sbUrl || !sbKey) return NextResponse.json({ ok: false, error: 'not-configured' }, { status: 503 });
  try {
    const r = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: sbKey, authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const u = (await r.json()) as { id?: string };
    if (!u.id) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ ok: true, ...(await sweep(u.id)) });
  } catch {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 502 });
  }
}

export const POST = handle;
export const GET = handle;
