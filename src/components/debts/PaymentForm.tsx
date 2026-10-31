'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { supabase } from '@/lib/supabase';
import { formatMoney, parseAmount, round2 } from '@/lib/currency';
import { remaining, validatePayment } from '@/lib/debt';
import { singleFlight } from '@/lib/finance';
import { tx } from '@/lib/text';
import type { Debt, Wallet } from '@/lib/types';

const once = singleFlight();

/** Installment in the debt's own currency, from/to a wallet of the same currency. */
export function PaymentForm({ debt, wallets, onDone }: { debt: Debt; wallets: Wallet[]; onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const eligible = wallets.filter((w) => w.currency === debt.currency && !w.is_archived);
  const left = remaining(debt.total_amount, debt.paid_amount);
  const [walletId, setWalletId] = useState(eligible[0]?.id ?? '');
  const [raw, setRaw] = useState(String(left));
  const [busy, setBusy] = useState(false);

  const amount = parseAmount(raw);
  const wallet = eligible.find((w) => w.id === walletId);
  const err = validatePayment(debt.total_amount, debt.paid_amount, amount);
  const short = debt.type === 'PAYABLE' && !!wallet && !err && wallet.balance < amount;
  const can = !!wallet && !err && !short && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can || !wallet) return;
    await once(async () => {
      setBusy(true);
      const { error } = await supabase().from('debt_payments').insert({ debt_id: debt.id, wallet_id: wallet.id, amount: round2(amount) });
      setBusy(false);
      if (error) return notify(error.message, 'error');
      notify(T('paymentDone'));
      await onDone();
    });
  }

  if (eligible.length === 0) return <p className="py-4 text-center text-sm text-amber-800 dark:text-amber-300">{T('noWalletSameCur')} ({debt.currency})</p>;

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted dark:text-night-muted">
        {debt.person_name} · {T('remaining')}: <span className="num font-mono font-semibold text-ink dark:text-paper">{formatMoney(left, debt.currency, lang)}</span>
      </p>
      <label className="block">
        <span className="label">{T('payAmount')} ({debt.currency})</span>
        <input className="field num font-mono text-lg" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{T('payWallet')}</span>
        <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
          {eligible.map((w) => <option key={w.id} value={w.id}>{w.name} — {formatMoney(w.balance, w.currency, lang)}</option>)}
        </select>
      </label>
      {raw.trim() !== '' && err && <p className="text-xs text-rose-700 dark:text-rose-400">{err === 'exceeds' ? T('payExceeds') : T('payInvalid')}</p>}
      {short && <p className="text-xs text-rose-700 dark:text-rose-400">{T('insufficient')}</p>}
      <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('recordPayment')}
      </button>
    </form>
  );
}
