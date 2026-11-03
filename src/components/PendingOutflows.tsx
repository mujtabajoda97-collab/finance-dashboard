'use client';

import { useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { useApp } from './Providers';
import { Sheet } from './Sheet';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { formatMoney, parseAmount, round2 } from '@/lib/currency';
import { todayDubai } from '@/lib/derived';
import { freeBalance } from '@/lib/reserve';
import { EXPENSE_CATEGORIES, type DictKey } from '@/lib/i18n';
import { CURRENCIES, type Currency, type PendingOutflow } from '@/lib/types';

const S = {
  title: ['مصروفات وتدفقات صادرة معلقة', 'Pending expenses & outflows'],
  add: ['+ إضافة مصروف معلق', '+ Add pending expense'],
  empty: ['لا توجد مصروفات معلقة. أضف فواتير الشهر مثل باقة الاتصال أو الإيجار.', 'No pending expenses. Add this month’s bills such as telecom or rent.'],
  total: ['إجمالي المعلق', 'Total pending'],
  noDate: ['بلا تاريخ', 'No date'],
  overdue: ['متأخر', 'Overdue'],
  pay: ['✓ تم السداد / خصم', '✓ Paid / deduct'],
  del: ['حذف', 'Delete'],
  sqlMissing: ['لتفعيل هذا القسم شغّل ملف SQL رقم 0012 مرة واحدة في Supabase.', 'Run SQL 0012 once in Supabase to enable this section.'],
  desc: ['الوصف (مثل: باقة الاتصال، إيجار الشقة)', 'Description (e.g. phone plan, rent)'],
  amount: ['المبلغ', 'Amount'],
  due: ['تاريخ الاستحقاق', 'Due date'],
  wallet: ['المحفظة المتوقع الدفع منها', 'Expected wallet'],
  noWallet: ['بدون تحديد', 'Not set'],
  category: ['التصنيف', 'Category'],
  save: ['حفظ', 'Save'],
  saved: ['أُضيف المصروف المعلق', 'Pending expense added'],
  payTitle: ['تأكيد السداد', 'Confirm payment'],
  payFrom: ['الخصم من المحفظة', 'Deduct from wallet'],
  curOnly: ['تظهر المحافظ بنفس عملة المصروف فقط.', 'Only wallets in the same currency are shown.'],
  needWallet: ['لا توجد محفظة بنفس العملة. أنشئ محفظة أولاً.', 'No wallet in this currency yet.'],
  low: ['رصيد المحفظة لا يكفي لهذا المبلغ.', 'The wallet balance is not enough.'],
  hint: ['سيُخصم المبلغ من المحفظة ويُسجَّل كمصروف فعلي في السجلات.', 'The amount is deducted and recorded as a real expense.'],
  paid: ['تم الخصم وتسجيل المصروف', 'Deducted and recorded'],
} as const;
type K = keyof typeof S;

/** Bills and rent that are due but not paid yet, with a one-tap "paid" that posts a real expense. */
export function PendingOutflows() {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const T = (k: K) => S[k][ar ? 0 : 1];
  const { pendingOut, pendingOutReady, loadPendingOut, wallets } = useData();
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<PendingOutflow | null>(null);
  const today = todayDubai();
  const open = pendingOut.filter((p) => p.status === 'PENDING');

  const totals = new Map<Currency, number>();
  for (const p of open) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);

  async function del(p: PendingOutflow) {
    const { error } = await supabase().from('pending_outflows').delete().eq('id', p.id);
    if (error) return notify(error.message, 'error');
    await loadPendingOut();
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{T('title')}</h2>
        {pendingOutReady && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> {T('add').replace(/^\+\s*/, '')}
          </button>
        )}
      </div>

      {!pendingOutReady ? (
        <p className="text-center text-sm text-muted dark:text-night-muted">{T('sqlMissing')}</p>
      ) : open.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted dark:text-night-muted">{T('empty')}</p>
      ) : (
        <>
          <p className="num text-sm text-muted dark:text-night-muted">
            {T('total')}: {[...totals.entries()].map(([c, v]) => formatMoney(v, c, lang)).join(' · ')}
          </p>
          <ul className="space-y-2">
            {open.map((p) => {
              const late = !!p.due_date && p.due_date < today;
              const w = wallets.find((x) => x.id === p.wallet_id);
              return (
                <li key={p.id} className="space-y-2 rounded-2xl border border-line p-3 dark:border-night-line">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.description}</p>
                      <p className="num text-xs text-muted dark:text-night-muted">
                        <span dir="ltr">{p.due_date ?? T('noDate')}</span>
                        {w && <span className="ms-2">· {w.name}</span>}
                        {late && <span className="ms-2 font-bold text-rose-600">{T('overdue')}</span>}
                      </p>
                    </div>
                    <span className="num shrink-0 font-mono text-sm font-bold text-rose-700 dark:text-rose-300">{formatMoney(p.amount, p.currency, lang)}</span>
                    <button type="button" className="icon-btn shrink-0" aria-label={T('del')} onClick={() => void del(p)}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <button type="button" className="btn btn-primary w-full py-2 text-sm" onClick={() => setPaying(p)}>
                    <Check className="size-4" aria-hidden /> {T('pay').replace(/^✓\s*/, '')}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {adding && <AddSheet onClose={() => setAdding(false)} />}
      {paying && <PaySheet item={paying} onClose={() => setPaying(null)} />}
    </section>
  );
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const { lang, notify, t } = useApp();
  const ar = lang === 'ar';
  const T = (k: K) => S[k][ar ? 0 : 1];
  const { wallets, loadPendingOut } = useData();
  const [raw, setRaw] = useState('');
  const [currency, setCurrency] = useState<Currency>('AED');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [walletId, setWalletId] = useState('');
  const [category, setCategory] = useState('BILLS');
  const [busy, setBusy] = useState(false);
  const amount = parseAmount(raw);
  const can = amount > 0 && desc.trim().length > 0 && !busy;
  const eligible = wallets.filter((w) => !w.is_archived && w.currency === currency);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const { error } = await supabase().from('pending_outflows').insert({
      amount: round2(amount),
      currency,
      description: desc.trim(),
      category,
      due_date: due || null,
      wallet_id: eligible.some((w) => w.id === walletId) ? walletId : null,
    });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(T('saved'));
    await loadPendingOut();
    onClose();
  }

  return (
    <Sheet title={T('add').replace(/^\+\s*/, '')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block"><span className="label">{T('desc')}</span>
          <input autoFocus className="field" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block"><span className="label">{T('amount')}</span>
            <input className="field num font-mono" inputMode="decimal" dir="ltr" value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
          <label className="block"><span className="label">&nbsp;</span>
            <select className="field" value={currency} onChange={(e) => { setCurrency(e.target.value as Currency); setWalletId(''); }} aria-label="currency">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="label">{T('due')}</span>
          <input type="date" className="field" dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="block"><span className="label">{T('wallet')}</span>
          <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">{T('noWallet')}</option>
            {eligible.map((w) => <option key={w.id} value={w.id}>{w.name} — {formatMoney(w.balance, w.currency, lang)}</option>)}
          </select></label>
        <label className="block"><span className="label">{T('category')}</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}` as DictKey)}</option>)}
          </select></label>
        <button type="submit" disabled={!can} className="btn btn-primary w-full">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
        </button>
      </form>
    </Sheet>
  );
}

function PaySheet({ item, onClose }: { item: PendingOutflow; onClose: () => void }) {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const T = (k: K) => S[k][ar ? 0 : 1];
  const { wallets, reserved, loadPendingOut, refreshMoney } = useData();
  const eligible = wallets.filter((w) => !w.is_archived && w.currency === item.currency);
  const [walletId, setWalletId] = useState(eligible.find((w) => w.id === item.wallet_id)?.id ?? eligible[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const w = eligible.find((x) => x.id === walletId);
  const short = !!w && w.balance < item.amount;
  const can = !!w && !short && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true);
    const { error } = await supabase().rpc('pay_pending_outflow', { p_id: item.id, p_wallet: walletId });
    setBusy(false);
    if (error) {
      const missing = /could not find the function|PGRST202|schema cache/i.test(error.message);
      return notify(missing ? T('sqlMissing') : error.message, 'error');
    }
    notify(T('paid'));
    await Promise.all([loadPendingOut(), refreshMoney()]);
    onClose();
  }

  return (
    <Sheet title={`${T('payTitle')} · ${item.description}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="num text-lg font-bold text-rose-700 dark:text-rose-300">{formatMoney(item.amount, item.currency, lang)}</p>
        <label className="block"><span className="label">{T('payFrom')}</span>
          <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {eligible.map((x) => <option key={x.id} value={x.id}>{x.name} — {formatMoney(x.balance, x.currency, lang)} ({ar ? 'متاح' : 'free'}: {formatMoney(freeBalance(x, reserved), x.currency, lang)})</option>)}
          </select>
          <span className="mt-1 block text-[11px] text-muted dark:text-night-muted">{T('curOnly')}</span>
        </label>
        {eligible.length === 0 && <p className="text-xs text-amber-800 dark:text-amber-300">{T('needWallet')}</p>}
        {short && <p className="text-xs text-rose-600 dark:text-rose-300">{T('low')}</p>}
        <p className="text-xs text-muted dark:text-night-muted">{T('hint')}</p>
        <button type="submit" disabled={!can} className="btn btn-primary w-full">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('pay')}
        </button>
      </form>
    </Sheet>
  );
}
