'use client';

import { useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { useApp } from './Providers';
import { Sheet } from './Sheet';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { convert, formatMoney, parseAmount, round2 } from '@/lib/currency';
import { todayDubai } from '@/lib/derived';
import { freeBalance } from '@/lib/reserve';
import { px as tx, type AnyKey } from '@/lib/ptext';
import { CURRENCIES, type Currency, type PendingInflow } from '@/lib/types';

type K = AnyKey;

/** Expected money that has not arrived yet, with a one-tap "received" action. */
export function PendingInflows() {
  const { lang } = useApp();
  const { pending, pendingReady, loadPending } = useData();
  const { notify } = useApp();
  const T = (k: K) => tx(lang, k);
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<PendingInflow | null>(null);
  const today = todayDubai();
  const open = pending.filter((p) => p.status === 'PENDING');

  const totals = new Map<Currency, number>();
  for (const p of open) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);

  async function del(p: PendingInflow) {
    const { error } = await supabase().from('pending_inflows').delete().eq('id', p.id);
    if (error) return notify(error.message, 'error');
    await loadPending();
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{T('pendTitle')}</h2>
        {pendingReady && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> {T('pendAdd')}
          </button>
        )}
      </div>

      {!pendingReady ? (
        <p className="text-center text-sm text-muted dark:text-night-muted">{T('pendSql10Missing')}</p>
      ) : open.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted dark:text-night-muted">{T('pendEmpty')}</p>
      ) : (
        <>
          <p className="num text-sm text-muted dark:text-night-muted">
            {T('pendTotal')}: {[...totals.entries()].map(([c, v]) => formatMoney(v, c, lang)).join(' · ')}
          </p>
          <ul className="space-y-2">
            {open.map((p) => {
              const late = !!p.due_date && p.due_date < today;
              return (
                <li key={p.id} className="flex items-center gap-2 rounded-2xl border border-line p-3 dark:border-night-line">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.description}</p>
                    <p className="num text-xs text-muted dark:text-night-muted" dir="ltr">
                      {p.due_date ?? T('pendNoDate')}{late && <span className="ms-2 font-bold text-rose-600">{T('overdue')}</span>}
                    </p>
                  </div>
                  <span className="num shrink-0 font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(p.amount, p.currency, lang)}</span>
                  <button type="button" className="btn btn-primary shrink-0 px-3 text-xs" onClick={() => setReceiving(p)}>
                    <Check className="size-4" aria-hidden /> {T('pendReceive')}
                  </button>
                  <button type="button" className="icon-btn shrink-0" aria-label={T('pendDelete')} onClick={() => del(p)}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {adding && <AddSheet onClose={() => setAdding(false)} />}
      {receiving && <ReceiveSheet item={receiving} onClose={() => setReceiving(null)} />}
    </section>
  );
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const { lang, notify } = useApp();
  const { loadPending } = useData();
  const T = (k: K) => tx(lang, k);
  const [raw, setRaw] = useState('');
  const [currency, setCurrency] = useState<Currency>('AED');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = parseAmount(raw);
  const can = amount > 0 && desc.trim().length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const { error } = await supabase().from('pending_inflows').insert({
      amount: round2(amount), currency, description: desc.trim(), due_date: due || null,
    });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(T('pendSaved'));
    await loadPending();
    onClose();
  }

  return (
    <Sheet title={T('pendAdd')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block"><span className="label">{T('amount')}</span>
            <input autoFocus className="field num font-mono" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
          <label className="block"><span className="label">&nbsp;</span>
            <select className="field" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} aria-label="currency">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="label">{T('pendSource')}</span>
          <input className="field" value={desc} placeholder={T('sourcePlaceholder')} onChange={(e) => setDesc(e.target.value)} /></label>
        <label className="block"><span className="label">{T('pendDue')}</span>
          <input type="date" className="field" dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="submit" disabled={!can} className="btn btn-primary w-full">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
        </button>
      </form>
    </Sheet>
  );
}

function ReceiveSheet({ item, onClose }: { item: PendingInflow; onClose: () => void }) {
  const { lang, notify } = useApp();
  const { wallets, projects, rates, reserved, reservationsReady, loadPending, loadWallets, loadReservations, loadProjects } = useData();
  const T = (k: K) => tx(lang, k);
  const eligible = wallets.filter((w) => !w.is_archived && w.currency === item.currency);
  const [walletId, setWalletId] = useState(eligible[0]?.id ?? '');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const projAmount = project ? convert(item.amount, item.currency, project.currency, rates) : null;
  const noRate = !!project && projAmount === null;
  const can = !!walletId && !busy && !noRate;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const { error } = await supabase().rpc('receive_pending_inflow', {
      p_id: item.id,
      p_wallet: walletId,
      p_project: project ? project.id : null,
      p_project_amount: project && projAmount !== null ? round2(projAmount) : null,
    });
    setBusy(false);
    if (error) {
      const missing = /could not find the function|PGRST202|schema cache/i.test(error.message);
      return notify(missing ? T('pendSql10Missing') : error.message, 'error');
    }
    notify(T('pendReceived'));
    await Promise.all([loadPending(), loadWallets(), loadReservations(), loadProjects()]);
    onClose();
  }

  return (
    <Sheet title={`${T('pendReceiveTitle')} · ${item.description}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="num text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(item.amount, item.currency, lang)}</p>
        <label className="block"><span className="label">{T('receiveToWallet')}</span>
          <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {eligible.map((w) => (
              <option key={w.id} value={w.id}>{w.name} — {formatMoney(w.balance, w.currency, lang)} ({T('freeShort')}: {formatMoney(freeBalance(w, reserved), w.currency, lang)})</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-muted dark:text-night-muted">{T('walletCurOnly')}</span>
        </label>
        {eligible.length === 0 && <p className="text-xs text-amber-800 dark:text-amber-300">{T('pendNeedWallet')}</p>}

        {reservationsReady && projects.length > 0 && (
          <label className="block"><span className="label">{T('reserveToProject')}</span>
            <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{T('noProjectOpt')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {project && projAmount !== null && (
              <span className="num mt-1 block text-xs text-muted dark:text-night-muted">{T('reservePreview')} {formatMoney(projAmount, project.currency, lang)}</span>
            )}
            {noRate && <span className="mt-1 block text-xs text-rose-600">{T('noRateNote')}</span>}
            <span className="mt-1 block text-[11px] text-muted dark:text-night-muted">{T('reserveNote')}</span>
          </label>
        )}

        <p className="text-xs text-muted dark:text-night-muted">{T('pendHint')}</p>
        <button type="submit" disabled={!can} className="btn btn-primary w-full">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('pendReceive')}
        </button>
      </form>
    </Sheet>
  );
}
