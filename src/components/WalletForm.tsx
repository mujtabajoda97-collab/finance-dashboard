'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from './Providers';
import { Sheet } from './Sheet';
import { supabase } from '@/lib/supabase';
import { parseAmount } from '@/lib/currency';
import { CURRENCIES, type Currency, type Wallet } from '@/lib/types';

interface Props {
  wallet: Wallet | null; // null = create
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function WalletForm({ wallet, onClose, onSaved }: Props) {
  const { t, notify } = useApp();
  const [name, setName] = useState(wallet?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(wallet?.currency ?? 'AED');
  const [opening, setOpening] = useState(wallet ? String(wallet.opening_balance) : '');
  const [minBal, setMinBal] = useState(wallet ? String(wallet.min_balance_threshold) : '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const opening_balance = opening.trim() === '' ? 0 : parseAmount(opening);
    const min_balance_threshold = minBal.trim() === '' ? 0 : parseAmount(minBal);
    if (Number.isNaN(opening_balance) || Number.isNaN(min_balance_threshold) || min_balance_threshold < 0) {
      return notify(t('error'), 'error');
    }
    setBusy(true);
    const payload = { name: name.trim(), opening_balance, min_balance_threshold };
    const sb = supabase();
    const { error } = wallet
      ? await sb.from('wallets').update(payload).eq('id', wallet.id)
      : await sb.from('wallets').insert({ ...payload, currency });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(t('saved'));
    await onSaved();
    onClose();
  }

  return (
    <Sheet title={wallet ? t('editWallet') : t('addWallet')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="w-name" className="label">{t('walletName')}</label>
          <input id="w-name" required className="field" placeholder={t('walletNameHint')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <span className="label">{t('currency')}</span>
          <div className="segmented" role="group">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                disabled={!!wallet}
                onClick={() => setCurrency(c)}
                className="font-mono disabled:opacity-60"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="w-open" className="label">{t('openingBalance')}</label>
            <input id="w-open" inputMode="decimal" dir="ltr" className="field num font-mono" placeholder="0.00" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </div>
          <div>
            <label htmlFor="w-min" className="label">{t('minBalance')}</label>
            <input id="w-min" inputMode="decimal" dir="ltr" className="field num font-mono" placeholder="0.00" value={minBal} onChange={(e) => setMinBal(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted dark:text-night-muted">{t('minBalanceHint')}</p>

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary flex-1 py-3">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('save')}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">{t('cancel')}</button>
        </div>
      </form>
    </Sheet>
  );
}
