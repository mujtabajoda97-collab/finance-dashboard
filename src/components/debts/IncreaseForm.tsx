'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { formatMoney, parseAmount, round2 } from '@/lib/currency';
import { remaining } from '@/lib/debt';
import { singleFlight } from '@/lib/finance';
import { freeBalance } from '@/lib/reserve';
import { tx } from '@/lib/text';
import { px } from '@/lib/ptext';
import type { Debt, Wallet } from '@/lib/types';

const once = singleFlight();

/**
 * Add an extra amount to an existing debt (SQL 0009, debt_increase).
 * Debt you owe  -> you borrowed more: the money ENTERS the chosen wallet.
 * Debt owed you -> you lent more: the money LEAVES the chosen wallet.
 */
export function IncreaseForm({ debt, wallets, onDone }: { debt: Debt; wallets: Wallet[]; onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const { reserved } = useData();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const P = (k: Parameters<typeof px>[1]) => px(lang, k);
  const eligible = wallets.filter((w) => w.currency === debt.currency && !w.is_archived);
  const lends = debt.type === 'RECEIVABLE';
  const [walletId, setWalletId] = useState(eligible[0]?.id ?? '');
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const amount = parseAmount(raw);
  const wallet = eligible.find((w) => w.id === walletId);
  const valid = Number.isFinite(amount) && amount > 0;
  const short = lends && !!wallet && valid && freeBalance(wallet, reserved) < amount;
  const can = !!wallet && valid && !short && !busy;
  const left = remaining(debt.total_amount, debt.paid_amount);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can || !wallet) return;
    await once(async () => {
      setBusy(true);
      const { error } = await supabase().rpc('debt_increase', {
        p_debt: debt.id, p_wallet: wallet.id, p_amount: round2(amount), p_note: note.trim() || null,
      });
      setBusy(false);
      if (error) {
        const missing = /could not find the function|PGRST202|schema cache/i.test(error.message);
        return notify(missing ? P('sql9Missing') : error.message, 'error');
      }
      notify(P('increaseDone'));
      await onDone();
    });
  }

  if (eligible.length === 0) {
    return <p className="py-4 text-center text-sm text-amber-800 dark:text-amber-300">{T('noWalletSameCur')} ({debt.currency})</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="num grid grid-cols-2 gap-2 rounded-xl bg-paper p-3 font-mono text-xs dark:bg-night">
        <span className="col-span-2 font-sans text-sm font-semibold">{debt.person_name} · {lends ? T('receivableShort') : T('payableShort')}</span>
        <span className="text-muted dark:text-night-muted">{T('total')}: {formatMoney(debt.total_amount, debt.currency, lang)}</span>
        <span className="text-muted dark:text-night-muted">{T('remaining')}: {formatMoney(left, debt.currency, lang)}</span>
      </div>

      <label className="block">
        <span className="label">{P('extraAmount')} ({debt.currency})</span>
        <input autoFocus className="field num font-mono text-lg" inputMode="decimal" dir="ltr" placeholder="0.00" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </label>

      <label className="block">
        <span className="label">{lends ? P('increaseWalletOut') : P('increaseWalletIn')}</span>
        <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
          {eligible.map((w) => {
            const r = reserved.get(w.id) ?? 0;
            return (
              <option key={w.id} value={w.id}>
                {w.name} — {formatMoney(w.balance, w.currency, lang)}{r > 0 ? ` (${P('freeShort')}: ${formatMoney(freeBalance(w, reserved), w.currency, lang)})` : ''}
              </option>
            );
          })}
        </select>
      </label>

      <label className="block">
        <span className="label">{P('noteOptional')}</span>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <p className="text-xs text-muted dark:text-night-muted">{lends ? P('increaseOutHint') : P('increaseInHint')}</p>
      {valid && (
        <p className="num rounded-xl bg-brand-500/10 p-3 text-sm font-semibold">
          {P('totalAfter')}: <span className="font-mono" dir="ltr">{formatMoney(round2(debt.total_amount + amount), debt.currency, lang)}</span>
        </p>
      )}
      {short && <p className="text-xs text-rose-700 dark:text-rose-400">{T('insufficient')} — {P('freeLabel')}: {wallet ? formatMoney(freeBalance(wallet, reserved), wallet.currency, lang) : ''}</p>}

      <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {P('increaseDebt')}
      </button>
    </form>
  );
}
