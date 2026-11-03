'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useApp } from './Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/lib/recipient';

const WAITS = [15, 30, 60, 120, 240, 480];

/** Emergency number: an important WhatsApp reply left unhandled for the chosen time is forwarded to it. */
export function EmergencySettings({ userId }: { userId: string }) {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const { profile, loadProfile } = useData();
  const [phone, setPhone] = useState('');
  const [mins, setMins] = useState(60);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPhone(profile?.emergency_phone ?? '');
    setMins(profile?.escalate_after_minutes ?? 60);
  }, [profile]);

  async function save() {
    if (phone.trim() && !normalizePhone(phone)) return notify(ar ? 'رقم الطوارئ غير صالح (استخدم الصيغة الدولية مثل +9715XXXXXXXX)' : 'Invalid number', 'error');
    setBusy(true);
    const { error } = await supabase().from('profiles').upsert(
      { user_id: userId, emergency_phone: phone.trim() || null, escalate_after_minutes: mins },
      { onConflict: 'user_id' },
    );
    setBusy(false);
    if (error) return notify(/column|schema cache/i.test(error.message) ? (ar ? 'شغّل ملف SQL رقم 0012 في Supabase أولاً.' : 'Run SQL 0012 in Supabase first.') : error.message, 'error');
    notify(ar ? 'تم الحفظ' : 'Saved');
    await loadProfile().catch(() => undefined);
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold"><ShieldAlert className="size-4 text-rose-500" aria-hidden /> {ar ? 'رقم الطوارئ وتصعيد الرسائل المهمة' : 'Emergency number & escalation'}</h2>
      <label className="block">
        <span className="label">{ar ? 'رقم هاتف الطوارئ المعتمد' : 'Emergency phone'}</span>
        <input className="field num font-mono" dir="ltr" inputMode="tel" placeholder="+9715XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{ar ? 'صعّد الرسالة المهمة إن لم أتفاعل معها خلال' : 'Escalate an unhandled important reply after'}</span>
        <select className="field" value={mins} onChange={(e) => setMins(Number(e.target.value))}>
          {WAITS.map((m) => <option key={m} value={m}>{m >= 60 ? (ar ? `${m / 60} ساعة` : `${m / 60} h`) : ar ? `${m} دقيقة` : `${m} min`}</option>)}
        </select>
      </label>
      <p className="text-xs text-muted dark:text-night-muted">
        {ar
          ? 'تُصنَّف ردود المدينين والدائنين الواردة على واتساب، وما كان مهماً (مهلة، تأجيل، اعتذار، ادّعاء سداد، أو كلمات عاجلة) ولم تضغط «تمت المعالجة» عليه خلال المدة، تُرسل رسالة واتساب بملخصه إلى رقم الطوارئ من حساب Green API الخاص بك. لا يمكن للخادم إجراء مكالمة هاتفية، فالتصعيد رسالة.'
          : 'Important replies you have not handled in time are forwarded as a WhatsApp message to this number. A server cannot place phone calls.'}
      </p>
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={save}>{ar ? 'حفظ' : 'Save'}</button>
    </section>
  );
}
