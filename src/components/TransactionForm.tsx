'use client';

import { useMemo, useRef, useState } from 'react';
import { Loader2, Lock, Trash2 } from 'lucide-react';
import { useApp } from './Providers';
import { Sheet } from './Sheet';
import { supabase } from '@/lib/supabase';
import { formatMoney, parseAmount, round2 } from '@/lib/currency';
import { buildTxnRow, overdrawn, singleFlight, suggestToAmount, toCents, txnEffects, validateTransfer, type TxnLike } from '@/lib/finance';
import { newRequestId } from '@/lib/flags';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type DictKey } from '@/lib/i18n';
import { fromDubaiInput, toDubaiInput } from '@/lib/time';
import type { RateMap, Txn, TxnType, Wallet } from '@/lib/types';

type Kind = Extract<TxnType, 'EXPENSE' | 'INCOME' | 'TRANSFER'>;

interface Props {
  /** null = create. */
  txn: Txn | null;
  /** Every wallet, archived included (needed to show history); only active ones are selectable. */
  wallets: Wallet[];
  rates: RateMap;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const isSudan = (x: Txn | null) => !!x && x.type === 'TRANSFER' && x.category === 'SUDAN_TRANSFER';

export function TransactionForm({ txn, wallets, rates, onClose, onSaved }: Props) {
  const { t, lang, notify } = useApp();
  const editing = !!txn;
  const sudan = isSudan(txn);
  const [kind, setKind] = useState<Kind>((txn?.type as Kind) ?? 'EXPENSE');
  const selectable = wallets.filter((w) => !w.is_archived || w.id === txn?.wallet_id || w.id === txn?.to_wallet_id);
  const firstActive = wallets.find((w) => !w.is_archived && w.currency === 'AED') ?? wallets.find((w) => !w.is_archived);
  const [walletId, setWalletId] = useState(txn?.wallet_id ?? firstActive?.id ?? '');
  const [toWalletId, setToWalletId] = useState(
    txn?.to_wallet_id ?? wallets.find((w) => !w.is_archived && w.id !== (txn?.wallet_id ?? firstActive?.id))?.id ?? '',
  );
  const [raw, setRaw] = useState(txn ? String(txn.amount) : '');
  const [toRaw, setToRaw] = useState(txn?.to_amount != null ? String(txn.to_amount) : '');
  const [toTouched, setToTouched] = useState(txn?.to_amount != null);
  const [category, setCategory] = useState(txn?.category ?? 'GENERAL');
  const [notes, setNotes] = useState(txn?.notes ?? '');
  const [dateStr, setDateStr] = useState(toDubaiInput(txn?.date ?? new Date()));
  const [busy, setBusy] = useState(false);
  // One idempotency key per opened form: a retry of the same submit can never post twice.
  const requestId = useRef(newRequestId());
  const flight = useRef(singleFlight());

  const from = wallets.find((w) => w.id === walletId);
  const to = wallets.find((w) => w.id === toWalletId);
  const amount = parseAmount(raw);
  const cross = kind === 'TRANSFER' && !!from && !!to && from.currency !== to.currency;

  // Suggested received amount (until the user types their own).
  const suggestion = useMemo(
    () => (cross && from && to && amount > 0 ? suggestToAmount(amount, from.currency, to.currency, rates) : null),
    [cross, from, to, amount, rates],
  );
  const toAmount = cross ? (toTouched ? parseAmount(toRaw) : suggestion ?? NaN) : null;

  const proposed: TxnLike | null = useMemo(() => {
    if (sudan || !from || !(amount > 0)) return null;
    return {
      type: kind,
      wallet_id: from.id,
      to_wallet_id: kind === 'TRANSFER' ? to?.id ?? null : null,
      amount: round2(amount),
      to_amount: cross && toAmount && toAmount > 0 ? round2(toAmount) : null,
    };
  }, [sudan, from, to, kind, amount, cross, toAmount]);

  const before: TxnLike | null = txn ? { type: txn.type, wallet_id: txn.wallet_id, to_wallet_id: txn.to_wallet_id, amount: txn.amount, to_amount: txn.to_amount } : null;
  const overdraws = proposed && kind !== 'INCOME' ? overdrawn(wallets, before, proposed) : [];
  const projected = useMemo(() => {
    if (!proposed || !from) return null;
    const eff = txnEffects(proposed);
    const old = before ? txnEffects(before) : new Map<string, number>();
    const cents = toCents(from.balance) + (eff.get(from.id) ?? 0) - (old.get(from.id) ?? 0);
    return cents / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposed, from, txn]);

  const categories = kind === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const catLabel = (c: string) => (`cat_${c}` as DictKey);

  function validate(): string | null {
    if (!from) return t('errNeedWallet');
    const iso = fromDubaiInput(dateStr);
    if (!iso) return t('errDate');
    if (sudan) return null;
    if (kind === 'TRANSFER') {
      if (!to) return t('errNeedWallet');
      const err = validateTransfer({ from, to, amount, toAmount: cross ? toAmount : null });
      if (err === 'amount') return t('errAmount');
      if (err === 'sameWallet') return t('errSameWallet');
      if (err === 'toAmount') return t('errToAmount');
      if (err === 'archived') return t('errArchived');
    } else if (!Number.isFinite(amount) || toCents(amount) <= 0) {
      return t('errAmount');
    }
    if (overdraws.length) return `${t('insufficientFunds')}: ${wallets.find((w) => w.id === overdraws[0])?.name ?? ''}`;
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await flight.current(async () => {
      const problem = validate();
      if (problem) return notify(problem, 'error');
      const iso = fromDubaiInput(dateStr) as string;
      setBusy(true);
      try {
        const sb = supabase();
        if (txn && sudan) {
          const { data, error } = await sb.from('transactions').update({ notes: notes.trim() || null, date: iso }).eq('id', txn.id).select('id');
          if (error) throw error;
          if (!data?.length) throw new Error(t('error'));
        } else {
          const row = buildTxnRow({
            type: kind,
            walletId: walletId,
            toWalletId: kind === 'TRANSFER' ? toWalletId : null,
            amount,
            toAmount: cross ? (toAmount as number) : null,
            category: kind === 'TRANSFER' ? null : category,
            notes,
            dateISO: iso,
            requestId: editing ? null : requestId.current,
            fromCurrency: from?.currency,
            toCurrency: to?.currency,
          });
          if (txn) {
            const { data, error } = await sb.from('transactions').update(row).eq('id', txn.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error(t('error'));
          } else {
            const { error } = await sb.from('transactions').insert(row);
            if (error) throw error;
          }
        }
        notify(t('saved'));
        await onSaved();
        onClose();
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        setBusy(false);
      }
    });
  }

  const [confirmDelete, setConfirmDelete] = useState(false);
  if (confirmDelete && txn) {
    return <ConfirmDelete txn={txn} wallets={wallets} onClose={() => setConfirmDelete(false)} onDone={async () => { await onSaved(); onClose(); }} />;
  }

  const locked = !!txn?.debt_payment_id;

  return (
    <Sheet title={editing ? t('editTxn') : t('addTxn')} onClose={onClose}>
      {locked ? (
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-paper p-3 text-sm dark:bg-night">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('editLocked')}
          </p>
          <button type="button" onClick={onClose} className="btn btn-ghost w-full">{t('cancel')}</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {!editing && (
            <div className="segmented" role="group" aria-label={t('filterType')}>
              {(['EXPENSE', 'INCOME', 'TRANSFER'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => { setKind(k); setCategory(k === 'INCOME' ? 'SALARY' : 'GENERAL'); }}
                >
                  {k === 'EXPENSE' ? t('kindExpense') : k === 'INCOME' ? t('kindIncome') : t('kindInternal')}
                </button>
              ))}
            </div>
          )}
          {sudan && <p className="rounded-xl bg-paper p-3 text-sm dark:bg-night">{t('sudanEditNote')}</p>}

          {!sudan && (
            <>
              <div className={kind === 'TRANSFER' ? 'grid gap-3 sm:grid-cols-2' : ''}>
                <div>
                  <label htmlFor="tx-w" className="label">{kind === 'TRANSFER' ? t('fromWallet') : t('wallets')}</label>
                  <select id="tx-w" className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                    {selectable.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.currency}{w.is_archived ? ' ⌀' : ''}</option>)}
                  </select>
                </div>
                {kind === 'TRANSFER' && (
                  <div>
                    <label htmlFor="tx-to" className="label">{t('toWallet')}</label>
                    <select id="tx-to" className="field" value={toWalletId} onChange={(e) => setToWalletId(e.target.value)}>
                      {selectable.filter((w) => w.id !== walletId).map((w) => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className={cross ? 'grid gap-3 sm:grid-cols-2' : ''}>
                <div>
                  <label htmlFor="tx-amt" className="label">{t('amount')}{from ? ` (${from.currency})` : ''}</label>
                  <input id="tx-amt" required inputMode="decimal" dir="ltr" className="field num font-mono" placeholder="0.00" value={raw} onChange={(e) => setRaw(e.target.value)} />
                </div>
                {cross && to && (
                  <div>
                    <label htmlFor="tx-rcv" className="label">{t('amountReceived')} ({to.currency})</label>
                    <input
                      id="tx-rcv"
                      required
                      inputMode="decimal"
                      dir="ltr"
                      className="field num font-mono"
                      placeholder="0.00"
                      value={toTouched ? toRaw : suggestion != null ? String(suggestion) : ''}
                      onChange={(e) => { setToTouched(true); setToRaw(e.target.value); }}
                    />
                  </div>
                )}
              </div>
              {cross && <p className="text-xs text-muted dark:text-night-muted">{t('amountReceivedHint')}</p>}

              {kind !== 'TRANSFER' && (
                <div>
                  <label htmlFor="tx-cat" className="label">{t('categoryLabel')}</label>
                  <select id="tx-cat" className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {!(categories as readonly string[]).includes(category) && <option value={category}>{category}</option>}
                    {categories.map((c) => <option key={c} value={c}>{t(catLabel(c))}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tx-date" className="label">{t('dateTime')}</label>
              <input id="tx-date" type="datetime-local" required dir="ltr" className="field num" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div>
              <label htmlFor="tx-notes" className="label">{t('notesLabel')}</label>
              <input id="tx-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {!sudan && projected !== null && from && (
            <p className={`text-xs ${overdraws.length ? 'font-semibold text-rose-600' : 'text-muted dark:text-night-muted'}`}>
              {t('balanceAfter')} ({from.name}): <span className="num font-mono">{formatMoney(projected, from.currency, lang)}</span>
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy} className="btn btn-primary flex-1 py-3">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('save')}
            </button>
            <button type="button" onClick={onClose} className="btn btn-ghost">{t('cancel')}</button>
          </div>
          {editing && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-ghost w-full text-rose-600">
              <Trash2 className="size-4" aria-hidden /> {t('deleteTxn')}
            </button>
          )}
        </form>
      )}
    </Sheet>
  );
}

function ConfirmDelete({ txn, wallets, onClose, onDone }: { txn: Txn; wallets: Wallet[]; onClose: () => void; onDone: () => Promise<void> }) {
  const { t, lang, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const flight = useRef(singleFlight());
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const before: TxnLike = { type: txn.type, wallet_id: txn.wallet_id, to_wallet_id: txn.to_wallet_id, amount: txn.amount, to_amount: txn.to_amount };
  // Deleting reverses the effect: show the resulting change per wallet.
  const reversed = [...txnEffects(before)].map(([id, cents]) => ({ w: byId.get(id), delta: -cents / 100 }));
  const negatives = overdrawn(wallets, before, null);

  async function remove() {
    await flight.current(async () => {
      setBusy(true);
      try {
        const { data, error } = await supabase().from('transactions').delete().eq('id', txn.id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error(t('error'));
        notify(t('deleted'));
        await onDone();
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), 'error');
        setBusy(false);
      }
    });
  }

  return (
    <Sheet title={t('deleteConfirmTitle')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">{t('deleteEffect')}</p>
        <ul className="space-y-1 text-sm">
          {reversed.map(({ w, delta }, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">{w?.name ?? '—'}</span>
              <span className="num font-mono font-semibold" dir="ltr">
                {delta >= 0 ? '+' : '−'}{formatMoney(Math.abs(delta), w?.currency ?? 'AED', lang)}
              </span>
            </li>
          ))}
        </ul>
        {negatives.length > 0 && (
          <p className="text-sm font-semibold text-rose-600">
            {t('goesNegative')} {negatives.map((id) => byId.get(id)?.name).join('، ')}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={remove} disabled={busy} className="btn flex-1 bg-rose-600 py-3 text-white hover:bg-rose-700">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('deleteTxn')}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">{t('cancel')}</button>
        </div>
      </div>
    </Sheet>
  );
}
