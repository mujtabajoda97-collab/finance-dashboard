'use client';

import { useEffect, useState } from 'react';
import { Loader2, Phone, Send, X } from 'lucide-react';
import { useApp } from './Providers';
import { ContactsFail, findContacts, type ContactHit } from '@/lib/contacts';
import { normalizePhone } from '@/lib/recipient';
import { sendWhatsApp } from '@/lib/notify';

export interface ContactRequest { kind: 'send' | 'call'; person: string; message?: string }

/**
 * Mandatory confirmation before anything is sent or dialled: shows the detected name, the phone number and the message.
 * Green API is only called after the user presses «تأكيد وإرسال». A call only opens the phone's dialer.
 */
export function ContactConfirm({ req, onClose }: { req: ContactRequest; onClose: (result: 'sent' | 'called' | 'cancelled') => void }) {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const [hits, setHits] = useState<ContactHit[] | null>(null);
  const [problem, setProblem] = useState<string>('');
  const [pick, setPick] = useState(0);
  const [other, setOther] = useState(false);
  const [manual, setManual] = useState('');
  const [text, setText] = useState(req.message ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    findContacts(req.person)
      .then((h) => { if (live) { setHits(h); if (h.length === 0) { setOther(true); setProblem(ar ? `لم أجد «${req.person}» في جهات الاتصال. أدخل الرقم يدوياً.` : `“${req.person}” was not found in your contacts. Enter the number.`); } } })
      .catch((e) => {
        if (!live) return;
        setHits([]);
        setOther(true);
        const code = e instanceof ContactsFail ? e.code : 'failed';
        setProblem(code === 'unsupported'
          ? (ar ? 'قراءة جهات الاتصال تعمل داخل تطبيق الأندرويد (بعد تثبيت آخر APK). أدخل الرقم يدوياً.' : 'Contacts work inside the Android app. Enter the number.')
          : code === 'denied'
            ? (ar ? 'لم يُمنح إذن جهات الاتصال. فعّله من إعدادات الهاتف أو أدخل الرقم يدوياً.' : 'Contacts permission denied. Enter the number.')
            : (ar ? 'تعذّر قراءة جهات الاتصال. أدخل الرقم يدوياً.' : 'Could not read contacts. Enter the number.'));
      });
    return () => { live = false; };
  }, [req.person, ar]);

  const chosen = other || !hits || hits.length === 0 ? null : hits[Math.min(pick, hits.length - 1)];
  const rawNumber = other ? manual : chosen?.phone ?? '';
  const digits = normalizePhone(rawNumber);
  const name = other ? (manual ? req.person : req.person) : chosen?.name ?? req.person;
  const canGo = !!digits && (req.kind === 'call' || text.trim().length > 0) && !busy;

  async function confirm() {
    if (!digits) return;
    if (req.kind === 'call') {
      onClose('called');
      window.location.href = `tel:+${digits}`;
      return;
    }
    setBusy(true);
    const r = await sendWhatsApp(text.trim(), digits);
    setBusy(false);
    if (r.ok) {
      notify(ar ? `أُرسلت الرسالة إلى ${name}` : `Message sent to ${name}`);
      onClose('sent');
    } else {
      notify(ar ? `تعذّر الإرسال (${r.error ?? ''}). تحقق من إعدادات واتساب.` : `Send failed (${r.error ?? ''}).`, 'error');
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={ar ? 'تأكيد' : 'Confirm'}>
      <div className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-night-card">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-bold">
            {req.kind === 'send'
              ? (ar ? 'هل تقصد هذا الرقم وتريد إرسال الرسالة؟' : 'Is this the right number? Send the message?')
              : (ar ? 'هل تقصد هذا الرقم وتريد الاتصال؟' : 'Is this the right number? Call?')}
          </h3>
          <button type="button" className="icon-btn" onClick={() => onClose('cancelled')} aria-label="×"><X className="size-5" aria-hidden /></button>
        </div>

        {hits === null ? (
          <p className="flex items-center gap-2 text-sm text-muted dark:text-night-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> {ar ? 'أبحث في جهات الاتصال…' : 'Searching contacts…'}</p>
        ) : (
          <>
            {problem && <p className="text-xs text-amber-800 dark:text-amber-300">{problem}</p>}
            {hits.length > 0 && !other && (
              <ul className="space-y-1.5">
                {hits.map((h, i) => (
                  <li key={`${h.name}-${h.phone}-${i}`}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 ${i === pick ? 'border-brand-500 bg-brand-500/10' : 'border-line dark:border-night-line'}`}>
                      <input type="radio" name="contact" checked={i === pick} onChange={() => setPick(i)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{h.name}</span>
                        <span className="num block font-mono text-xs" dir="ltr">{h.phone}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {other && (
              <label className="block">
                <span className="label">{ar ? `رقم ${req.person}` : `Number for ${req.person}`}</span>
                <input className="field num font-mono" dir="ltr" inputMode="tel" placeholder="+9715XXXXXXXX" value={manual} onChange={(e) => setManual(e.target.value)} autoFocus />
                {manual && !digits && <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">{ar ? 'الرقم غير صالح (استخدم الصيغة الدولية)' : 'Invalid number'}</span>}
              </label>
            )}
            {req.kind === 'send' && (
              <label className="block">
                <span className="label">{ar ? 'نص الرسالة' : 'Message'}</span>
                <textarea className="field min-h-24" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            {digits && <p className="num text-xs text-muted dark:text-night-muted" dir="ltr">→ +{digits}</p>}
            <div className="grid grid-cols-1 gap-2">
              <button type="button" className="btn btn-primary py-3" disabled={!canGo} onClick={() => void confirm()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : req.kind === 'send' ? <Send className="size-4 rtl:-scale-x-100" aria-hidden /> : <Phone className="size-4" aria-hidden />}
                {req.kind === 'send' ? (ar ? 'تأكيد وإرسال' : 'Confirm & send') : ar ? 'تأكيد واتصال' : 'Confirm & call'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn border border-line py-2 dark:border-night-line" onClick={() => (other && hits.length > 0 ? setOther(false) : setOther(true))}>
                  {other && hits.length > 0 ? (ar ? 'العودة للنتائج' : 'Back to results') : ar ? 'اختيار رقم آخر' : 'Use another number'}
                </button>
                <button type="button" className="btn border border-line py-2 dark:border-night-line" onClick={() => onClose('cancelled')}>{ar ? 'إلغاء' : 'Cancel'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
