'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { supabase } from '@/lib/supabase';
import { parseAmount, round2 } from '@/lib/currency';
import { tx } from '@/lib/text';
import { CURRENCIES, type Currency, type Debt, type DebtStatusDb, type DebtType } from '@/lib/types';

/** Edit the core fields of a debt: type, person, total, currency and due date. The status follows the amounts already paid. */
export function EditDebtForm({ debt, onDone }: { debt: Debt; onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const [person, setPerson] = useState(debt.person_name);
  const [type, setType] = useState<DebtType>(debt.type);
  const [currency, setCurrency] = useState<Currency>(debt.currency);
  const [raw, setRaw] = useState(String(debt.total_amount));
  const [due, setDue] = useState(debt.due_date ?? '');
  const [busy, setBusy] = useState(false);
  const total = parseAmount(raw);
  const paid = Number(debt.paid_amount) || 0;
  const tooLow = total > 0 && round2(total) < round2(paid);
  const can = person.trim() !== '' && total > 0 && !tooLow && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    const t = round2(total);
    const status: DebtStatusDb = paid >= t ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN';
    setBusy(true);
    const { error } = await supabase().from('debts').update({
      person_name: person.trim(),
      type,
      currency,
      total_amount: t,
      due_date: due || null,
      status,
    }).eq('id', debt.id);
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(ar ? 'تم تحديث الدين' : 'Debt updated');
    await onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="segmented" role="group" aria-label={T('debtType')}>
        <button type="button" aria-pressed={type === 'PAYABLE'} onClick={() => setType('PAYABLE')}>{ar ? 'دين عليك' : T('payableShort')}</button>
        <button type="button" aria-pressed={type === 'RECEIVABLE'} onClick={() => setType('RECEIVABLE')}>{ar ? 'دين لك' : T('receivableShort')}</button>
      </div>
      <label className="block"><span className="label">{T('person')}</span>
        <input autoFocus className="field" value={person} onChange={(e) => setPerson(e.target.value)} /></label>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2"><span className="label">{T('totalAmount')}</span>
          <input className="field num font-mono" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
        <label><span className="label">{T('currency')}</span>
          <select className="field px-2" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
      </div>
      {tooLow && <p className="text-xs text-rose-600 dark:text-rose-300">{ar ? `المبلغ أقل من المسدّد (${paid}).` : `Total is below the amount already paid (${paid}).`}</p>}
      <label className="block"><span className="label">{T('dueDate')}</span>
        <input type="date" dir="ltr" className="field num font-mono" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
      </button>
    </form>
  );
}
