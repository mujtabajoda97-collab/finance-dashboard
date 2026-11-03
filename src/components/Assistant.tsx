'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useApp } from './Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/paging';
import { formatMoney, round2, toAED } from '@/lib/currency';
import { startOfMonthDubai } from '@/lib/time';
import { todayDubai, isTaskOverdue } from '@/lib/derived';
import { remaining, validatePayment } from '@/lib/debt';
import { summarize } from '@/lib/projects';
import { buildTxnRow } from '@/lib/finance';
import { newRequestId } from '@/lib/flags';
import { VoiceFail, getAutoSpeak, listenOnce, setAutoSpeak, speak, stopListening, stopSpeaking } from '@/lib/voice';
import { getAiKey, getAiModel, getProvider } from '@/lib/assistantKey';
import type { Currency, Debt, Wallet } from '@/lib/types';

interface Action { type: 'expense' | 'income' | 'debt_payment'; amount: number; wallet?: string; category?: string; notes?: string; person?: string }
interface Msg { role: 'user' | 'model'; text: string; actions?: Action[]; done?: Record<number, string> }

const CHIPS = [
  { ar: 'رتّب أولويات اليوم', en: 'Arrange today’s priorities', q: 'رتّب لي أهم الالتزامات والمواعيد اليوم (مهام متأخرة ومستحقة، ديون مستحقة، محافظ منخفضة) ترتيباً مرقّماً مع سبب كل بند.' },
  { ar: 'حلّل إنفاقي', en: 'Analyze my spending', q: 'حلّل إنفاقي هذا الشهر حسب البنود وقارنه بالشهر الماضي، وأعطني ملاحظتين عمليتين.' },
  { ar: 'عجز/فائض المشاريع', en: 'Project deficit/surplus', q: 'احسب لكل مشروع (بما فيه الزواج إن وُجد) العجز أو الفائض المتبقي مقارنةً بالتدفقات المتوقعة.' },
  { ar: 'رسالة مطالبة ودّية', en: 'Friendly collection note', q: 'اكتب رسالة واتساب ودّية ولبقة لتذكير أكثر مدين تأخراً بدينه.' },
];


export function Assistant() {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const data = useData();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const prev = useRef<Record<string, number> | null>(null);
  const [auto, setAuto] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setAuto(getAutoSpeak()); }, []);
  useEffect(() => { if (!open) { stopSpeaking(); stopListening(); setSpeaking(null); } }, [open]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);

  const byCat = (rows: { wallet_id: string; type: string; category: string | null; amount: number }[]) => {
    const wmap = new Map(data.allWallets.map((w) => [w.id, w]));
    const out: Record<string, number> = {};
    for (const t of rows) {
      if (t.type !== 'EXPENSE') continue;
      const w = wmap.get(t.wallet_id);
      const aed = w ? toAED(Number(t.amount), w.currency, data.rates) : null;
      if (aed === null) continue;
      const k = t.category ?? 'GENERAL';
      out[k] = round2((out[k] ?? 0) + aed);
    }
    return out;
  };

  async function prevMonth(): Promise<Record<string, number>> {
    if (prev.current) return prev.current;
    try {
      const from = startOfMonthDubai(new Date(), -1).toISOString();
      const to = startOfMonthDubai().toISOString();
      const res = await fetchAllPages<any>(async (lo, hi) => {
        const { data: d, error } = await supabase().from('transactions').select('wallet_id,type,category,amount').gte('date', from).lt('date', to).order('id').range(lo, hi);
        if (error) throw error;
        return d ?? [];
      }, 1000, 5000);
      prev.current = byCat(res.rows);
    } catch {
      prev.current = {};
    }
    return prev.current;
  }

  async function buildContext(): Promise<string> {
    const today = todayDubai();
    const spent = byCat(data.monthTxns);
    const ctx = {
      today,
      currencyNote: 'AED هي العملة المرجعية',
      wallets: data.wallets.map((w) => ({ name: w.name, currency: w.currency, balance: w.balance, min: w.min_balance_threshold })),
      debts: data.debts.filter((d) => d.status !== 'PAID').map((d) => ({ person: d.person_name, type: d.type === 'RECEIVABLE' ? 'له عندك/مطلوب لك' : 'عليك', currency: d.currency, remaining: remaining(d.total_amount, d.paid_amount), due: d.due_date })),
      tasks: data.tasks.slice(0, 25).map((t) => ({ title: t.title, due: t.due_date, overdue: isTaskOverdue(t), priority: t.priority, notes: t.description })),
      projects: data.projects.filter((p) => !p.is_archived).map((p) => {
        const s = summarize(p, data.cashflows, data.rates, today);
        return { name: p.name, currency: p.currency, budget: p.budget, spent: s.spent, remainingCost: s.remainingCost, allocated: s.allocated, pendingIn: s.pendingIn, net: s.net, needed: s.needed, targetDate: p.target_date ?? null };
      }),
      monthSpendingAED: spent,
      prevMonthSpendingAED: await prevMonth(),
    };
    return JSON.stringify(ctx);
  }

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setText('');
    setBusy(true);
    try {
      const { data: s } = await supabase().auth.getSession();
      const token = s.session?.access_token;
      const r = await fetch('/api/assistant/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ prompt: q, context: await buildContext(), history, provider: getProvider(), apiKey: getAiKey() || undefined, model: getAiModel() || undefined }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string; data?: { reply?: string; actions?: Action[] } };
      if (!j.ok) {
        const map: Record<string, string> = {
          'no-key': ar ? 'لم يُضبط مفتاح المزوّد المختار بعد. أضفه من الإعدادات ← المساعد الذكي.' : 'No key for the selected provider yet. Add it in Settings → Smart assistant.',
          'key-rejected': ar ? 'رفض المزوّد المفتاح. تحقق منه في الإعدادات.' : 'The provider rejected the key.',
          'model-not-found': ar ? 'الموديل غير متاح لحسابك. اكتب اسم موديل آخر في الإعدادات.' : 'Model not available for your account. Set another model in Settings.',
          timeout: ar ? 'تأخر رد المزوّد، حاول مرة أخرى.' : 'The provider timed out, try again.',
          quota: ar ? 'تم تجاوز حصة المزوّد حالياً. حاول لاحقاً.' : 'Provider quota exceeded.',
          unauthorized: ar ? 'انتهت الجلسة، سجّل الدخول من جديد.' : 'Session expired.',
        };
        throw new Error((map[j.error ?? ''] ?? (ar ? 'تعذّر الوصول للمساعد الآن.' : 'Assistant unavailable.')) + (j.detail ? `\n(${j.detail})` : !j.error ? `\n(HTTP ${r.status})` : ''));
      }
      const acts = Array.isArray(j.data?.actions) ? j.data!.actions!.filter((a) => a && ['expense', 'income', 'debt_payment'].includes(a.type) && Number(a.amount) > 0) : [];
      const reply = j.data?.reply ?? '…';
      setMsgs((m) => [...m, { role: 'model', text: reply, actions: acts, done: {} }]);
      if (getAutoSpeak()) void speak(reply, ar ? 'ar' : 'en').catch(() => undefined);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'model', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    if (listening) { stopListening(); return; }
    stopSpeaking();
    setSpeaking(null);
    setListening(true);
    try {
      const heard = await listenOnce(ar ? 'ar' : 'en');
      setListening(false);
      await ask(heard);
    } catch (e) {
      setListening(false);
      const code = e instanceof VoiceFail ? e.code : 'failed';
      const t: Record<string, [string, string]> = {
        unsupported: ['الإدخال الصوتي غير مدعوم هنا. حدّث التطبيق (APK الجديد) أو اكتب أمرك.', 'Voice input is not supported here. Update the app or type.'],
        denied: ['لم يُمنح إذن الميكروفون. فعّله من إعدادات الهاتف ← التطبيقات ← الأذونات.', 'Microphone permission was not granted. Enable it in the phone settings.'],
        'no-speech': ['لم أسمع شيئاً، حاول مرة أخرى.', 'I did not hear anything, try again.'],
        failed: ['تعذّر التعرف على الصوت، حاول مرة أخرى.', 'Speech recognition failed, try again.'],
      };
      notify(t[code][ar ? 0 : 1], 'error');
    }
  }

  async function readAloud(i: number, text: string) {
    if (speaking === i) { stopSpeaking(); setSpeaking(null); return; }
    setSpeaking(i);
    try {
      await speak(text, ar ? 'ar' : 'en');
    } catch {
      notify(ar ? 'القراءة الصوتية غير متاحة. ثبّت صوتاً عربياً من إعدادات الهاتف ← تحويل النص إلى كلام.' : 'Text-to-speech is unavailable on this device.', 'error');
    } finally {
      setSpeaking((c) => (c === i ? null : c));
    }
  }

  /** Executes a confirmed action with the same database calls the manual forms use. */
  async function run(mi: number, ai: number, a: Action, walletId: string, amount: number) {
    const sb = supabase();
    const setDone = (t: string) => setMsgs((ms) => ms.map((m, i) => (i === mi ? { ...m, done: { ...m.done, [ai]: t } } : m)));
    const w = data.wallets.find((x) => x.id === walletId);
    if (!w || !(amount > 0)) return setDone(ar ? '✗ اختر محفظة ومبلغاً صحيحاً' : '✗ Pick a wallet and amount');
    try {
      if (a.type === 'debt_payment') {
        const person = (a.person ?? '').trim().toLowerCase();
        const debt = data.debts.find((d) => d.status !== 'PAID' && d.person_name.toLowerCase().includes(person) && person) as Debt | undefined;
        if (!debt) return setDone(ar ? '✗ لم أجد دَيناً مفتوحاً بهذا الاسم' : '✗ No open debt for that name');
        if (w.currency !== debt.currency) return setDone(ar ? `✗ عملة المحفظة (${w.currency}) تختلف عن عملة الدين (${debt.currency})` : '✗ Currency mismatch');
        const err = validatePayment(debt.total_amount, debt.paid_amount, amount);
        if (err) return setDone(err === 'exceeds' ? (ar ? '✗ المبلغ أكبر من المتبقي' : '✗ More than remaining') : ar ? '✗ مبلغ غير صالح' : '✗ Invalid amount');
        if (debt.type === 'PAYABLE' && w.balance < amount) return setDone(ar ? '✗ رصيد المحفظة غير كافٍ' : '✗ Insufficient balance');
        const { error } = data.reservationsReady
          ? await sb.rpc('debt_pay', { p_debt: debt.id, p_wallet: w.id, p_amount: round2(amount), p_project: null, p_project_amount: null })
          : await sb.from('debt_payments').insert({ debt_id: debt.id, wallet_id: w.id, amount: round2(amount) });
        if (error) throw error;
        await Promise.all([data.loadDebts(), data.refreshMoney(), data.loadReservations().catch(() => undefined)]);
        return setDone(ar ? `✓ سُجّل سداد ${formatMoney(amount, w.currency, lang)} (${debt.person_name})` : '✓ Payment recorded');
      }
      if (a.type === 'expense' && w.balance < amount) return setDone(ar ? '✗ رصيد المحفظة غير كافٍ' : '✗ Insufficient balance');
      const cat = a.type === 'income'
        ? (['SALARY', 'PROJECT', 'GENERAL'].includes(a.category ?? '') ? (a.category as string) : 'GENERAL')
        : (['GENERAL', 'FOOD', 'GROCERIES', 'TRANSPORT', 'BILLS', 'RENT', 'PERSONAL', 'SHOPPING', 'HEALTH'].includes(a.category ?? '') ? (a.category as string) : 'GENERAL');
      const row = buildTxnRow({ type: a.type === 'income' ? 'INCOME' : 'EXPENSE', walletId: w.id, amount, category: cat, notes: a.notes ?? '', dateISO: new Date().toISOString(), requestId: newRequestId() });
      const { error } = await sb.from('transactions').insert(row);
      if (error) throw error;
      await data.refreshMoney();
      setDone(ar ? `✓ سُجّل ${a.type === 'income' ? 'دخل' : 'مصروف'} ${formatMoney(amount, w.currency, lang)}` : '✓ Recorded');
    } catch (e) {
      setDone(`✗ ${(e as Error).message}`);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={ar ? 'المساعد الذكي' : 'Smart assistant'}
        className="fixed bottom-24 end-4 z-40 inline-flex size-14 items-center justify-center rounded-full bg-brand-500 text-night shadow-lg transition hover:scale-105 lg:bottom-6">
        <Sparkles className="size-6" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-night" role="dialog" aria-label={ar ? 'المساعد الذكي' : 'Smart assistant'}>
          <header className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-night-line">
            <h2 className="flex items-center gap-2 text-base font-bold"><Sparkles className="size-5 text-brand-500" aria-hidden /> {ar ? 'المساعد الذكي' : 'Smart assistant'}</h2>
            <div className="flex items-center gap-1">
              <button type="button" className={`icon-btn ${auto ? '!bg-brand-500 !text-night' : ''}`} aria-pressed={auto} title={ar ? 'قراءة الردود تلقائياً' : 'Read replies aloud automatically'} aria-label={ar ? 'قراءة الردود تلقائياً' : 'Auto read replies'}
                onClick={() => { const v = !auto; setAuto(v); setAutoSpeak(v); if (!v) { stopSpeaking(); setSpeaking(null); } }}>
                {auto ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
              </button>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="×"><X className="size-5" aria-hidden /></button>
            </div>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {msgs.length === 0 && (
              <div className="space-y-3 text-sm text-muted dark:text-night-muted">
                <p>{ar ? 'اكتب أو انطق أمرك، مثل: «صرفت 150 درهم كاش في البقالة» أو «سددت لعاصم 500 درهم من المارية». سأعرض لك التفاصيل لتؤكدها قبل التسجيل.' : 'Type or say a command, e.g. “I spent 150 AED cash on groceries”. I will ask you to confirm before saving.'}</p>
                <div className="flex flex-wrap gap-2">
                  {CHIPS.map((c) => (
                    <button key={c.q} type="button" onClick={() => ask(c.q)} className="rounded-full border border-brand-500/50 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-400">{ar ? c.ar : c.en}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, mi) => (
              <div key={mi} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'bg-brand-500 text-night' : 'border border-line bg-card dark:border-night-line dark:bg-night-card'}`}>
                  {m.text}
                  {m.role === 'model' && m.text.length > 20 && (
                    <span className="mt-2 flex items-center gap-3">
                      <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 dark:text-brand-400" aria-label={ar ? 'قراءة الرد' : 'Read aloud'} onClick={() => void readAloud(mi, m.text)}>
                        {speaking === mi ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />} {speaking === mi ? (ar ? 'إيقاف' : 'Stop') : ar ? 'استماع' : 'Listen'}
                      </button>
                      <button type="button" className="text-[11px] font-semibold text-brand-700 dark:text-brand-400" onClick={() => { void navigator.clipboard?.writeText(m.text); notify(ar ? 'تم النسخ' : 'Copied'); }}>{ar ? 'نسخ النص' : 'Copy'}</button>
                    </span>
                  )}
                  {m.actions?.map((a, ai) => <ActionCard key={ai} a={a} wallets={data.wallets} done={m.done?.[ai]} ar={ar} onRun={(wid, amt) => run(mi, ai, a, wid, amt)} />)}
                </div>
              </div>
            ))}
            {busy && <div className="flex justify-start"><Loader2 className="size-5 animate-spin text-brand-500" aria-hidden /></div>}
            <div ref={endRef} />
          </div>
          <form className="flex items-center gap-2 border-t border-line p-3 dark:border-night-line" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <button type="button" onClick={() => void toggleVoice()} disabled={busy} aria-label={ar ? 'إدخال صوتي' : 'Voice'} aria-pressed={listening} className={`icon-btn ${listening ? '!bg-rose-500 !text-white animate-pulse' : ''}`}><Mic className="size-5" aria-hidden /></button>
            <input className="field flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={ar ? 'اكتب أمرك أو سؤالك…' : 'Type a command or question…'} />
            <button type="submit" disabled={busy || !text.trim()} className="btn btn-primary" aria-label="send"><Send className="size-4 rtl:-scale-x-100" aria-hidden /></button>
          </form>
        </div>
      )}
    </>
  );
}

function ActionCard({ a, wallets, done, ar, onRun }: { a: Action; wallets: Wallet[]; done?: string; ar: boolean; onRun: (walletId: string, amount: number) => void }) {
  const guess = wallets.find((w) => a.wallet && (w.name.toLowerCase().includes(a.wallet.toLowerCase()) || a.wallet.toLowerCase().includes(w.name.toLowerCase())));
  const [wid, setWid] = useState(guess?.id ?? '');
  const [amt, setAmt] = useState(String(a.amount));
  const [busy, setBusy] = useState(false);
  const label = a.type === 'expense' ? (ar ? 'مصروف' : 'Expense') : a.type === 'income' ? (ar ? 'دخل' : 'Income') : ar ? `سداد دين — ${a.person ?? ''}` : 'Debt payment';
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-brand-500/40 bg-brand-500/10 p-2.5">
      <p className="text-xs font-bold">{label}{a.notes ? ` · ${a.notes}` : ''}{a.category ? ` · ${a.category}` : ''}</p>
      {done ? (
        <p className="text-xs font-semibold">{done}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <input className="field num w-24 font-mono" dir="ltr" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <select className="field min-w-0 flex-1" value={wid} onChange={(e) => setWid(e.target.value)}>
              <option value="">{ar ? 'اختر المحفظة' : 'Choose wallet'}</option>
              {wallets.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.currency as Currency})</option>)}
            </select>
          </div>
          <button type="button" disabled={busy} className="btn btn-primary w-full py-2" onClick={async () => { setBusy(true); await onRun(wid, Number(amt.replace(/[^\d.]/g, ''))); setBusy(false); }}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {ar ? 'تأكيد وتسجيل' : 'Confirm & save'}
          </button>
        </>
      )}
    </div>
  );
}
