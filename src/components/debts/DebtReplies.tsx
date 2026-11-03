'use client';

import { useState } from 'react';
import { Check, MessageCircle } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { sendWhatsApp } from '@/lib/notify';
import { todayDubai } from '@/lib/derived';
import type { Debt, WaInbox } from '@/lib/types';

const LABEL: Record<WaInbox['category'], [string, string]> = {
  EXTENSION: ['طلب مهلة', 'Asks for more time'],
  POSTPONE: ['طلب تأجيل', 'Asks to postpone'],
  APOLOGY: ['اعتذار', 'Apology'],
  PAID_CLAIM: ['يقول إنه سدّد', 'Says it was paid'],
  OTHER: ['رد آخر', 'Other reply'],
};

/** WhatsApp replies of the debtor, analysed by the webhook: text + class, with reschedule / reply shortcuts. */
export function DebtReplies({ debt }: { debt: Debt }) {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const { inbox, loadInbox, loadDebts } = useData();
  const mine = inbox.filter((m) => m.debt_id === debt.id);
  if (mine.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-sky-400/40 bg-sky-500/10 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-sky-800 dark:text-sky-300"><MessageCircle className="size-4" aria-hidden /> {ar ? 'ردود واتساب' : 'WhatsApp replies'}</p>
      {mine.map((m) => <Reply key={m.id} m={m} debt={debt} ar={ar} notify={notify} reload={async () => { await Promise.all([loadInbox(), loadDebts()]); }} />)}
    </div>
  );
}

function Reply({ m, debt, ar, notify, reload }: { m: WaInbox; debt: Debt; ar: boolean; notify: (t: string, k?: 'success' | 'error') => void; reload: () => Promise<void> }) {
  const [reply, setReply] = useState(m.suggested_reply ?? '');
  const [busy, setBusy] = useState(false);
  const days = m.suggest_days ?? 7;

  async function handled() {
    await supabase().from('wa_inbox').update({ handled: true }).eq('id', m.id);
    await reload();
  }
  async function reschedule() {
    setBusy(true);
    const base = debt.due_date && debt.due_date > todayDubai() ? debt.due_date : todayDubai();
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    const { error } = await supabase().from('debts').update({ due_date: next }).eq('id', debt.id);
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(ar ? `أُعيدت الجدولة إلى ${next}` : `Rescheduled to ${next}`);
    await handled();
  }
  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    const r = await sendWhatsApp(reply.trim(), m.from_phone);
    setBusy(false);
    if (!r.ok) return notify(ar ? 'تعذّر الإرسال' : 'Send failed', 'error');
    notify(ar ? 'أُرسل الرد' : 'Reply sent');
    await handled();
  }

  return (
    <div className="space-y-1.5 rounded-lg bg-white/60 p-2.5 text-xs dark:bg-black/20">
      <p className="font-bold">{LABEL[m.category][ar ? 0 : 1]}</p>
      <p className="whitespace-pre-wrap break-words">«{m.body}»</p>
      {m.summary && <p className="text-muted dark:text-night-muted">{m.summary}</p>}
      <textarea className="field min-h-16 text-xs" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={ar ? 'رد مقترح…' : 'Suggested reply…'} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !reply.trim()} className="btn btn-primary !py-1.5 text-xs" onClick={send}>{ar ? 'إرسال الرد' : 'Send reply'}</button>
        {(m.category === 'EXTENSION' || m.category === 'POSTPONE') && debt.status !== 'PAID' && (
          <button type="button" disabled={busy} className="btn border border-brand-500/60 !py-1.5 text-xs" onClick={reschedule}>{ar ? `أجّل الموعد ${days} يوم` : `Postpone ${days} days`}</button>
        )}
        <button type="button" disabled={busy} className="btn btn-ghost !py-1.5 text-xs" onClick={handled}><Check className="size-3.5" aria-hidden /> {ar ? 'تم الاطلاع' : 'Dismiss'}</button>
      </div>
    </div>
  );
}
