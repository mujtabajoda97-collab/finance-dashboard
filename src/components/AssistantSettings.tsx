'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from './Providers';
import { getGeminiKey, setGeminiKey } from '@/lib/assistantKey';

export function AssistantSettings() {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const [v, setV] = useState(() => getGeminiKey());
  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold"><Sparkles className="size-4 text-brand-500" aria-hidden /> {ar ? 'المساعد الذكي (Gemini)' : 'Smart assistant (Gemini)'}</h2>
      <p className="text-xs text-muted dark:text-night-muted">
        {ar ? 'اختياري: مفتاح GEMINI_API_KEY الخاص بك. يُحفظ على هذا الجهاز فقط. إن تركته فارغاً يُستخدم مفتاح الخادم (متغير GEMINI_API_KEY في Vercel) إن وُجد.' : 'Optional: your own GEMINI_API_KEY, stored on this device only. If empty, the server key (GEMINI_API_KEY in Vercel) is used when set.'}
      </p>
      <input className="field font-mono" dir="ltr" type="password" autoComplete="off" placeholder="AIza…" value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="btn btn-primary w-full" onClick={() => { setGeminiKey(v); notify(ar ? 'تم الحفظ' : 'Saved'); }}>{ar ? 'حفظ' : 'Save'}</button>
    </section>
  );
}
