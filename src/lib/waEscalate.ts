/**
 * Server-side escalation of important WhatsApp replies (debtors / creditors) that the owner has not handled in time.
 * It sends one WhatsApp message through the owner's own Green API instance to the emergency number saved in Settings.
 * (A server cannot place a phone call: the message is the escalation, and the owner's phone also gets the in-app alert.)
 * Needs SUPABASE_SERVICE_ROLE_KEY and SQL 0012.
 */
const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const svc = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const H = () => ({ apikey: svc(), authorization: `Bearer ${svc()}`, 'content-type': 'application/json' });

async function rest<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(`${url()}/rest/v1/${path}`, { ...init, headers: { ...H(), ...(init?.headers ?? {}) }, cache: 'no-store' });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? (JSON.parse(t) as T) : ([] as unknown as T);
  } catch {
    return null;
  }
}

function digitsOf(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  return d.length >= 8 && d.length <= 15 && !d.startsWith('0') ? d : null;
}

interface Row { id: string; user_id: string; debt_id: string | null; from_phone: string; body: string; summary: string | null; created_at: string }
interface Prof { user_id: string; emergency_phone: string | null; escalate_after_minutes: number | null; green_api_id_instance: string | null; green_api_token_instance: string | null }

export async function sweep(onlyUser?: string): Promise<{ configured: boolean; sent: number }> {
  if (!svc() || !url()) return { configured: false, sent: 0 };
  const cutoff = encodeURIComponent(new Date(Date.now() - 5 * 60_000).toISOString());
  const rows = await rest<Row[]>(
    `wa_inbox?select=id,user_id,debt_id,from_phone,body,summary,created_at&important=eq.true&handled=eq.false&escalated_at=is.null&created_at=lt.${cutoff}${onlyUser ? `&user_id=eq.${onlyUser}` : ''}&order=created_at.asc&limit=50`,
  );
  if (!rows || rows.length === 0) return { configured: true, sent: 0 };

  const users = [...new Set(rows.map((r) => r.user_id))].filter((u) => /^[0-9a-f-]{36}$/i.test(u));
  const profs = await rest<Prof[]>(
    `profiles?select=user_id,emergency_phone,escalate_after_minutes,green_api_id_instance,green_api_token_instance&user_id=in.(${users.join(',')})`,
  );
  const debtIds = [...new Set(rows.map((r) => r.debt_id).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
  const debts = debtIds.length ? await rest<{ id: string; person_name: string }[]>(`debts?select=id,person_name&id=in.(${debtIds.join(',')})`) : [];
  const nameOf = new Map((debts ?? []).map((d) => [d.id, d.person_name]));

  let sent = 0;
  for (const u of users) {
    const p = (profs ?? []).find((x) => x.user_id === u);
    const to = digitsOf(p?.emergency_phone ?? '');
    const inst = (p?.green_api_id_instance ?? '').trim();
    const tok = (p?.green_api_token_instance ?? '').trim();
    if (!p || !to || !/^\d{4,15}$/.test(inst) || !/^[A-Za-z0-9]{16,128}$/.test(tok)) continue;
    const waitMs = Math.min(1440, Math.max(5, Number(p.escalate_after_minutes) || 60)) * 60_000;
    const due = rows.filter((r) => r.user_id === u && Date.now() - new Date(r.created_at).getTime() >= waitMs);
    if (due.length === 0) continue;

    const lines = due.slice(0, 6).map((r) => {
      const who = (r.debt_id && nameOf.get(r.debt_id)) || `+${r.from_phone}`;
      const mins = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60_000);
      return `• ${who} (+${r.from_phone}) منذ ${mins} دقيقة: «${(r.summary || r.body).slice(0, 120)}»`;
    });
    const message = `⚠️ تنبيه من تطبيق «نظام إدارة حياتي»\nرسائل واتساب مهمة لم يتم الاطلاع عليها:\n${lines.join('\n')}\n\nيرجى التواصل مع صاحب التطبيق أو الاتصال بهؤلاء الأشخاص.`;
    try {
      const r = await fetch(`https://${inst.slice(0, 4)}.api.greenapi.com/waInstance${inst}/sendMessage/${tok}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: `${to}@c.us`, message }),
        cache: 'no-store',
      });
      if (!r.ok) continue;
    } catch {
      continue;
    }
    await rest(`wa_inbox?id=in.(${due.map((d) => d.id).join(',')})`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ escalated_at: new Date().toISOString() }),
    });
    sent += due.length;
  }
  return { configured: true, sent };
}
