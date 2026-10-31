'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { convert, formatMoney, parseAmount, round2 } from '@/lib/currency';
import { remaining, validatePayment } from '@/lib/debt';
import { singleFlight } from '@/lib/finance';
import { freeBalance } from '@/lib/reserve';
import { tx } from '@/lib/text';
import { px } from '@/lib/ptext';
import type { Debt, Wallet } from '@/lib/types';

const once = singleFlight();

/**
 * Installment in the debt's own currency, from/to a wallet of the same currency.
 * Collected debts (RECEIVABLE) can optionally be routed to a project: the money enters the wallet
 * but is reserved for that project (SQL 0008).
 */
export function PaymentForm({ debt, wallets, onDone }: { debt: Debt; wallets: Wallet[]; onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const { projects, rates, reserved, reservationsReady, loadProjects, loadReservations } = useData();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const P = (k: Parameters<typeof px>[1]) => px(lang, k);
  const eligible = wallets.filter((w) => w.currency === debt.currency && !w.is_archived);
  const left = remaining(debt.total_amount, debt.paid_amount);
  const [walletId, setWalletId] = useState(eligible[0]?.id ?? '');
  const [raw, setRaw] = useState(String(left));
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);

  const canReserve = debt.type === 'RECEIVABLE' && reservationsReady && projects.length > 0;
  const project = canReserve ? projects.find((p) => p.id === projectId) : undefined;
  const amount = parseAmount(raw);
  const wallet = eligible.find((w) => w.id === walletId);
  const err = validatePayment(debt.total_amount, debt.paid_amount, amount);
  // Paying a debt cannot use money that is reserved for projects.
  const short = debt.type === 'PAYABLE' && !!wallet && !err && freeBalance(wallet, reserved) < amount;
  const projAmount = project && amount > 0 ? convert(amount, debt.currency, project.currency, rates) : null;
  const noRate = !!project && amount > 0 && projAmount === null;
  const can = !!wallet && !err && !short && !noRate && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can || !wallet) return;
    await once(async () => {
      setBusy(true);
      const amt = round2(amount);
      const { error } = reservationsReady
        ? await supabase().rpc('debt_pay', {
            p_debt: debt.id, p_wallet: wallet.id, p_amount: amt,
            p_project: project?.id ?? null, p_project_amount: project && projAmount !== null ? round2(projAmount) : null,
          })
        : await supabase().from('debt_payments').insert({ debt_id: debt.id, wallet_id: wallet.id, amount: amt });
      setBusy(false);
      if (error) return notify(error.message, 'error');
      notify(T('paymentDone'));
      await Promise.all([loadProjects(), loadReservations()]);
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

      {canReserve && (
        <div className="space-y-2 rounded-xl border border-line p-3 dark:border-night-line">
          <label className="block">
            <span className="label">{P('reserveToProject')}</span>
            <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{P('noProjectOpt')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}
            </select>
          </label>
          {project && (
            <p className="text-xs text-emerald-800 dark:text-emerald-300">
              {P('reserveNote')}
              {projAmount !== null && (
                <> {P('reservePreview')} <span className="num font-mono font-semibold" dir="ltr">{formatMoney(projAmount, project.currency, lang)}</span></>
              )}
            </p>
          )}
          {noRate && <p className="text-xs text-rose-700 dark:text-rose-400">{P('noRateNote')}</p>}
        </div>
      )}

      {raw.trim() !== '' && err && <p className="text-xs text-rose-700 dark:text-rose-400">{err === 'exceeds' ? T('payExceeds') : T('payInvalid')}</p>}
      {short && <p className="text-xs text-rose-700 dark:text-rose-400">{T('insufficient')} — {P('freeLabel')}: {wallet ? formatMoney(freeBalance(wallet, reserved), wallet.currency, lang) : ''}</p>}
      <button type="submit" disabled={!can} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('recordPayment')}
      </button>
    </form>
  );
}
