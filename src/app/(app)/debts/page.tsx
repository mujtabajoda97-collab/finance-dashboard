'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Bell, Check, ChevronDown, Plus, Wallet as WalletIcon } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { Sheet } from '@/components/Sheet';
import { PaymentForm } from '@/components/debts/PaymentForm';
import { DebtForm } from '@/components/debts/DebtForm';
import { AlertPicker } from '@/components/AlertPicker';
import { syncDebtReminder } from '@/lib/debtReminder';
import { debtDueInstant, getDebtChoice, setDebtChoice, type AlertChoice } from '@/lib/alertPrefs';
import { fromDubaiInput } from '@/lib/time';
import { useData } from '@/lib/data';
import { formatMoney, toAED } from '@/lib/currency';
import { remaining } from '@/lib/debt';
import { isDebtOverdue, isOpenDebt, liveAlerts } from '@/lib/derived';
import { APP_TZ, intlLocale } from '@/lib/time';
import { tx } from '@/lib/text';
import type { Debt, DebtType } from '@/lib/types';

export default function DebtsPage() {
  const { lang } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const data = useData();
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [adding, setAdding] = useState(false);

  const totals = (type: DebtType) => {
    let rem = 0, tot = 0, partial = false;
    for (const d of data.debts) {
      if (d.type !== type) continue;
      const r = toAED(remaining(d.total_amount, d.paid_amount), d.currency, data.rates);
      const t = toAED(d.total_amount, d.currency, data.rates);
      if (r === null || t === null) { partial = true; continue; }
      rem += r; tot += t;
    }
    return { rem, tot, partial };
  };
  const owed = totals('RECEIVABLE');
  const owe = totals('PAYABLE');

  const live = liveAlerts(data.wallets, data.tasks, data.debts);
  const sdg = data.rateRows.find((r) => r.base_currency === 'AED' && r.target_currency === 'SDG');
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const statusChip = (d: Debt) => {
    if (d.status === 'PAID') return { text: T('completed'), cls: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-400/40', icon: <Check className="size-3" aria-hidden /> };
    if (isDebtOverdue(d)) return { text: T('overdue'), cls: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-400/40', icon: <AlertTriangle className="size-3" aria-hidden /> };
    return { text: d.status === 'PARTIAL' ? T('partial') : T('pending'), cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-400/40', icon: <AlertTriangle className="size-3" aria-hidden /> };
  };

  const summary = (label: string, v: { rem: number; tot: number; partial: boolean }, tone: string, bar: string) => {
    const pct = v.tot > 0 ? Math.min(100, ((v.tot - v.rem) / v.tot) * 100) : 0;
    return (
      <div className={`rounded-2xl border bg-gradient-to-br p-3.5 ${tone}`}>
        <p className="text-sm font-semibold opacity-90">{label}</p>
        <p className="num mt-1 font-mono text-xl font-bold">{formatMoney(v.rem, 'AED', lang)}{v.partial && ' *'}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25"><div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} /></div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-16">
      <div className="grid grid-cols-2 gap-3">
        {summary(T('owedToYou'), owed, 'from-emerald-500/30 to-emerald-900/10 border-emerald-400/40 text-emerald-700 dark:text-emerald-100', 'bg-emerald-300')}
        {summary(T('youOwe'), owe, 'from-rose-500/30 to-rose-900/10 border-rose-400/40 text-rose-700 dark:text-rose-100', 'bg-rose-300')}
      </div>
      {(owed.partial || owe.partial) && <p className="text-xs text-amber-800 dark:text-amber-300">* {T('partialNote')}</p>}

      {data.debts.length === 0 ? (
        <p className="card py-10 text-center text-sm text-muted dark:text-night-muted">{T('noDebts')}</p>
      ) : (
        <ul className="space-y-2.5">
          {data.debts.map((d) => {
            const chip = statusChip(d);
            const left = remaining(d.total_amount, d.paid_amount);
            const isOpen = open === d.id;
            return (
              <li key={d.id} className={`card !p-0 ${isDebtOverdue(d) ? '!border-rose-400/40' : ''}`}>
                <button type="button" className="flex w-full items-center gap-3 p-4 text-start" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
                  <ChevronDown className={`size-4 shrink-0 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{d.person_name} <span className="text-xs font-normal text-muted dark:text-night-muted">({d.type === 'RECEIVABLE' ? T('receivableShort') : T('payableShort')})</span></p>
                    <p className={`num font-mono text-lg font-bold ${d.type === 'RECEIVABLE' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{formatMoney(d.status === 'PAID' ? d.total_amount : left, d.currency, lang)}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold ${chip.cls}`}>{chip.text}{chip.icon}</span>
                </button>
                {isOpen && (
                  <div className="space-y-2 border-t border-line px-4 pb-4 pt-3 text-sm dark:border-night-line">
                    <div className="num grid grid-cols-2 gap-2 font-mono text-xs">
                      <span className="text-muted dark:text-night-muted">{T('total')}: {formatMoney(d.total_amount, d.currency, lang)}</span>
                      <span className="text-muted dark:text-night-muted">{T('paidSoFar')}: {formatMoney(d.paid_amount, d.currency, lang)}</span>
                      {d.due_date && <span className="text-muted dark:text-night-muted">{T('dueDate')}: {d.due_date}</span>}
                    </div>
                    {d.notes && <p className="text-xs text-muted dark:text-night-muted">{d.notes}</p>}
                    {isOpenDebt(d) && d.due_date && <DebtAlert debt={d} />}
                    {isOpenDebt(d) && (
                      <button type="button" className="btn btn-primary w-full" onClick={() => setPaying(d)}>
                        <WalletIcon className="size-4" aria-hidden /> {T('recordPayment')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={() => setAdding(true)} className="btn w-full border border-dashed border-line py-3 text-muted dark:border-night-line dark:text-night-muted">
        <Plus className="size-4" aria-hidden /> {T('addDebt')}
      </button>

      <section id="alerts" aria-labelledby="alerts-title" className="scroll-mt-20 space-y-2.5">
        <h2 id="alerts-title" className="text-base font-bold">{T('alertsLog')}</h2>
        <ul className="space-y-2">
          {live.map((a) => (
            <li key={a.id} className="card flex items-center gap-3 !p-3.5">
              <AlertTriangle className="size-5 shrink-0 text-amber-800 dark:text-amber-300" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{a.kind === 'LOW_BALANCE' ? T('lowBalanceAlert') : a.kind === 'TASK_OVERDUE' ? T('taskLate') : T('debtDue')}</p>
                <p className="truncate text-xs text-muted dark:text-night-muted">{a.ref}</p>
              </div>
            </li>
          ))}
          {sdg && (
            <li className="card flex items-center gap-3 !p-3.5">
              <ArrowLeftRight className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{T('rateUpdated')}</p>
                <p className="num text-xs text-muted dark:text-night-muted">1 AED = {sdg.rate} SDG · {fmt.format(new Date(sdg.updated_at))}</p>
              </div>
            </li>
          )}
          {data.alerts.map((a) => (
            <li key={a.id} className="card flex items-center gap-3 !p-3.5">
              <Bell className="size-5 shrink-0 text-brand-700 dark:text-brand-400" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{a.message}</p>
                <p className="num text-xs text-muted dark:text-night-muted">{fmt.format(new Date(a.created_at))}</p>
              </div>
            </li>
          ))}
          {live.length === 0 && !sdg && data.alerts.length === 0 && (
            <li className="card py-6 text-center text-sm text-muted dark:text-night-muted">{T('noAlerts')}</li>
          )}
        </ul>
      </section>

      {paying && (
        <Sheet title={T('recordPayment')} onClose={() => setPaying(null)}>
          <PaymentForm debt={paying} wallets={data.wallets} onDone={async () => { setPaying(null); await Promise.all([data.loadDebts(), data.refreshMoney(), data.loadAlerts()]); }} />
        </Sheet>
      )}
      {adding && (
        <Sheet title={T('addDebt')} onClose={() => setAdding(false)}>
          <DebtForm onDone={async () => { setAdding(false); await data.loadDebts(); }} />
        </Sheet>
      )}
    </div>
  );
}

function DebtAlert({ debt }: { debt: Debt }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const dueAt = debtDueInstant(debt);
  const [choice, setChoice] = useState<AlertChoice>(() => getDebtChoice(debt.id, dueAt === null ? null : new Date(dueAt)));
  const [err, setErr] = useState(false);

  function save() {
    if (choice.mode === 'custom') {
      const at = fromDubaiInput(choice.custom);
      if (!at || dueAt === null || new Date(at).getTime() > dueAt) { setErr(true); return; }
    }
    setErr(false);
    setDebtChoice(debt.id, choice);
    void syncDebtReminder(debt.id, choice, dueAt === null ? null : new Date(dueAt));
    notify(T('alertSaved'));
  }

  return (
    <div className="space-y-2 rounded-2xl border border-line p-3 dark:border-night-line">
      <AlertPicker value={choice} onChange={(v) => { setChoice(v); setErr(false); }} error={err} />
      <p className="text-[11px] text-muted dark:text-night-muted">{T('alertDebtNote')}</p>
      <button type="button" onClick={save} className="btn w-full border border-line py-2 dark:border-night-line">{T('save')}</button>
    </div>
  );
}
