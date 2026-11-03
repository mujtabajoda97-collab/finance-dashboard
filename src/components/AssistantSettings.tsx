'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from './Providers';
import { PROVIDERS, getAiKey, getAiModel, getProvider, setAiKey, setAiModel, setProvider, type AiProvider } from '@/lib/assistantKey';

export function AssistantSettings() {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const [provider, setProv] = useState<AiProvider>(() => getProvider());
  const [key, setKey] = useState(() => getAiKey(getProvider()));
  const [model, setModel] = useState(() => getAiModel(getProvider()));
  const info = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  function pick(p: AiProvider) {
    setProv(p);
    setKey(getAiKey(p));
    setModel(getAiModel(p));
  }
  function save() {
    setProvider(provider);
    setAiKey(provider, key);
    setAiModel(provider, model);
    notify(ar ? 'تم الحفظ' : 'Saved');
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold"><Sparkles className="size-4 text-brand-500" aria-hidden /> {ar ? 'المساعد الذكي' : 'Smart assistant'}</h2>
      <label className="block">
        <span className="label">{ar ? 'مزوّد الذكاء الاصطناعي' : 'AI provider'}</span>
        <select className="field" value={provider} onChange={(e) => pick(e.target.value as AiProvider)}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">{ar ? `مفتاح ${info.label} (API Key)` : `${info.label} API key`}</span>
        <input className="field font-mono" dir="ltr" type="password" autoComplete="off" placeholder={info.hint} value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{ar ? 'الموديل (اختياري)' : 'Model (optional)'}</span>
        <input className="field font-mono" dir="ltr" placeholder={info.model} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <p className="text-xs text-muted dark:text-night-muted">
        {ar ? 'يُحفظ المفتاح على هذا الجهاز فقط. إن تركته فارغاً يُستخدم مفتاح الخادم (متغير بيئة في Vercel) إن وُجد. اترك الموديل فارغاً لاستخدام الافتراضي.' : 'The key stays on this device. If empty, the server key (a Vercel env variable) is used when set. Leave the model empty for the default.'}
      </p>
      <button type="button" className="btn btn-primary w-full" onClick={save}>{ar ? 'حفظ' : 'Save'}</button>
    </section>
  );
}
