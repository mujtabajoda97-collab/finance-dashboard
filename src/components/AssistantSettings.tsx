'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from './Providers';
import { OPENAI_MODELS, PROVIDERS, getAiKey, getAiModel, getProvider, setAiKey, setAiModel, setProvider, type AiProvider } from '@/lib/assistantKey';

export function AssistantSettings() {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const [provider, setProv] = useState<AiProvider>(() => getProvider());
  const [key, setKey] = useState(() => getAiKey(getProvider()));
  const [model, setModel] = useState(() => getAiModel(getProvider()));
  const info = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const [fetched, setFetched] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  /** Models this OpenAI account can really use (GET /v1/models), chat-capable families only. */
  async function loadModels() {
    if (!key) { notify(ar ? 'أدخل مفتاح OpenAI أولاً' : 'Enter the OpenAI key first'); return; }
    setLoading(true);
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { data?: { id: string }[] };
      const bad = /(audio|realtime|embed|tts|whisper|image|transcribe|moderation|search|instruct|dall|davinci|babbage|computer|codex)/i;
      const ids = (j.data ?? []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !bad.test(id)).sort();
      setFetched(ids);
      notify(ar ? `تم جلب ${ids.length} موديل` : `Loaded ${ids.length} models`);
    } catch {
      notify(ar ? 'تعذّر جلب الموديلات (تحقق من المفتاح). القائمة الافتراضية متاحة.' : 'Could not load models (check the key). The default list is available.');
    } finally {
      setLoading(false);
    }
  }
  const options = Array.from(new Set([...(OPENAI_MODELS.map((m) => m.id)), ...fetched]));
  const labelOf = (id: string) => OPENAI_MODELS.find((m) => m.id === id)?.[ar ? 'ar' : 'en'] ?? '';

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
        {provider === 'openai' ? (
          <>
            <select className="field font-mono" dir="ltr" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">{ar ? `الافتراضي (${info.model})` : `Default (${info.model})`}</option>
              {model && !options.includes(model) && <option value={model}>{model}</option>}
              {options.map((id) => <option key={id} value={id}>{id}{labelOf(id) ? ` — ${labelOf(id)}` : ''}</option>)}
            </select>
            <button type="button" className="btn mt-2 w-full" disabled={loading} onClick={loadModels}>
              {loading ? (ar ? 'جارٍ الجلب…' : 'Loading…') : ar ? 'جلب الموديلات المتاحة لحسابي' : 'Fetch models available to my account'}
            </button>
          </>
        ) : (
          <input className="field font-mono" dir="ltr" placeholder={info.model} value={model} onChange={(e) => setModel(e.target.value)} />
        )}
      </label>
      <p className="text-xs text-muted dark:text-night-muted">
        {ar ? 'للتسجيل الصوتي الدقيق (Whisper) والمكالمة الصوتية يلزم مفتاح OpenAI حتى لو اخترت مزوّداً آخر للمحادثة. ' : 'Accurate voice input (Whisper) and live calls need an OpenAI key. '}
        {ar ? 'يُحفظ المفتاح على هذا الجهاز فقط. إن تركته فارغاً يُستخدم مفتاح الخادم (متغير بيئة في Vercel) إن وُجد. اترك الموديل فارغاً لاستخدام الافتراضي.' : 'The key stays on this device. If empty, the server key (a Vercel env variable) is used when set. Leave the model empty for the default.'}
      </p>
      <button type="button" className="btn btn-primary w-full" onClick={save}>{ar ? 'حفظ' : 'Save'}</button>
    </section>
  );
}
