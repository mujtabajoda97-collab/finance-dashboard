'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { supabase } from '@/lib/supabase';
import { parseAmount, round2 } from '@/lib/currency';
import { tx } from '@/lib/text';
import { AlertPicker } from '../AlertPicker';
import { debtDueInstant, setDebtChoice, type AlertChoice } from '@/lib/alertPrefs';
import { syncDebtReminder } from '@/lib/debtReminder';
import { fromDubaiInput, toDubaiInput } from '@/lib/time';
import { CURRENCIES, type Currency, type DebtType } from '@/lib/types';

export function DebtForm({ onDone }: { onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const [person, setPerson] = useState('');
  const [type, setType] = useState<DebtType>('PAYABLE');
  const [currency, setCurrency] = useState<Currency>('AED');
  const [raw, setRaw] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<AlertChoice>(() => ({ mode: '24h', custom: toDubaiInput(new Date(Date.now() + 3600_000)) }));
  const [alertErr, setAlertErr] = useState(false);
  const total = parseAmount(raw);
  const can = person.trim() !== '' && total > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    if (due && alert.mode === 'custom') {
      const at = fromDubaiInput(alert.custom);
      const dueAt = debtDueInstant({ due_date: due } as Parameters<typeof debtDueInstant>[0]);
      if (!at || dueAt === null || new Date(at).getTime() > dueAt) { setAlertErr(true); return; }
    }
    setAlertErr(false);
    setBusy(true);
    const { data: created, error } = await supabase().from('debts').insert({
      person_name: person.trim(),
      type,
      currency,
      total_amount: round2(total),
      due_date: due || null,
      notes: notes.trim() || null,
    }).select('id').single();
    setBusy(false);
    if (error) return notify(error.message, 'error');
    if (created?.id && due) {
      setDebtChoice(created.id as string, alert);
      const dueAt = debtDueInstant({ due_date: due } as Parameters<typeof debtDueInstant>[0]);
      await syncDebtReminder(created.id as string, alert, dueAt === null ? null : new Date(dueAt));
    }
    await onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block"><span className="label">{T('person')}</span>
        <input autoFocus className="field" value={person} onChange={(e) => setPerson(e.target.value)} /></label>
      <div className="segmented" role="group" aria-label={T('debtType')}>
        <button type="button" aria-pressed={type === 'PAYABLE'} onClick={() => setType('PAYABLE')}>{T('payableShort')}</button>
        <button type="button" aria-pressed={type === 'RECEIVABLE'} onClick={() => setType('RECEIVABLE')}>{T('receivableShort')}</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2"><span className="label">{T('totalAmount')}</span>
          <input className="field num font-mono" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
        <label><span className="label">{T('currency')}</span>
          <select className="field px-2" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
      </div>
      <label className="block"><span className="label">{T('dueDate')}</span>
        <input type="date" dir="ltr" className="field num font-mono" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <AlertPicker value={alert} onChange={(v) => { setAlert(v); setAlertErr(false); }} disabled={!due} error={alertErr} />
      <p className="-mt-1 text-xs text-muted dark:text-night-muted">{due ? T('alertDebtNote') : T('alertNeedsDue')}</p>
      <label className="block"><span className="label">{T('notes')}</span>
        <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('addDebt')}
      </button>
    </form>
  );
}
