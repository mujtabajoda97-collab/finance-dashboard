'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from './Providers';
import { ANTHROPIC_MODELS, OPENAI_MODELS, PROVIDERS, getAiKey, getAiModel, getProvider, setAiKey, setAiModel, setProvider, type AiProvider } from '@/lib/assistantKey';

const CUSTOM = '__custom__';

export function AssistantSettings() {
  const { lang, notify } = useApp();
  const ar = lang === 'ar';
  const [provider, setProv] = useState<AiProvider>(() => getProvider());
  const [key, setKey] = useState(() => getAiKey(getProvider()));
  const [model, setModel] = useState(() => getAiModel(getProvider()));
  const [fetched, setFetched] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(false);
  const info = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const builtIn = provider === 'openai' ? OPENAI_MODELS : provider === 'anthropic' ? ANTHROPIC_MODELS : [];
  const options = Array.from(new Set([...builtIn.map((m) => m.id), ...fetched]));
  const labelOf = (id: string) => builtIn.find((m) => m.id === id)?.[ar ? 'ar' : 'en'] ?? '';
  const isCustom = custom || (model !== '' && !options.includes(model));
  const hasList = provider !== 'gemini';

  /** Models this account can really use: GET /v1/models at OpenAI or Anthropic. */
  async function loadModels() {
    if (!key) { notify(ar ? 'أدخل المفتاح أولاً' : 'Enter the key first'); return; }
    setLoading(true);
    try {
      let ids: string[] = [];
      if (provider === 'openai') {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { data?: { id: string }[] };
        const bad = /(audio|realtime|embed|tts|whisper|image|transcribe|moderation|search|instruct|dall|davinci|babbage|computer|codex)/i;
        ids = (j.data ?? []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !bad.test(id));
      } else if (provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { data?: { id: string }[] };
        ids = (j.data ?? []).map((m) => m.id);
      }
      ids.sort();
      setFetched(ids);
      notify(ar ? `تم جلب ${ids.length} موديل` : `Loaded ${ids.length} models`);
    } catch {
      notify(ar ? 'تعذّر جلب الموديلات (تحقق من المفتاح). القائمة المدمجة متاحة، ويمكنك كتابة اسم الموديل يدوياً.' : 'Could not load models (check the key). The built-in list and a custom name are available.');
    } finally {
      setLoading(false);
    }
  }

  function pick(p: AiProvider) {
    setProv(p);
    setKey(getAiKey(p));
    setModel(getAiModel(p));
    setFetched([]);
    setCustom(false);
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
      <div className="block">
        <span className="label">{ar ? 'الموديل' : 'Model'}</span>
        {hasList ? (
          <>
            <select className="field font-mono" dir="ltr" value={isCustom ? CUSTOM : model}
              onChange={(e) => { if (e.target.value === CUSTOM) { setCustom(true); } else { setCustom(false); setModel(e.target.value); } }}>
              <option value="">{ar ? `الافتراضي (${info.model})` : `Default (${info.model})`}</option>
              {options.map((id) => <option key={id} value={id}>{id}{labelOf(id) ? ` — ${labelOf(id)}` : ''}</option>)}
              <option value={CUSTOM}>{ar ? '✎ اسم موديل مخصص…' : '✎ Custom model name…'}</option>
            </select>
            {isCustom && (
              <input className="field mt-2 font-mono" dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder={ar ? 'اكتب اسم الموديل بالضبط، مثل: gpt-5 أو claude-sonnet-5-5' : 'Exact model name, e.g. gpt-5'}
                value={model} onChange={(e) => setModel(e.target.value.trim())} />
            )}
            <button type="button" className="btn mt-2 w-full" disabled={loading} onClick={loadModels}>
              {loading ? (ar ? 'جارٍ الجلب…' : 'Loading…') : ar ? 'جلب الموديلات المتاحة لحسابي' : 'Fetch models available to my account'}
            </button>
          </>
        ) : (
          <input className="field font-mono" dir="ltr" autoCapitalize="none" placeholder={info.model} value={model} onChange={(e) => setModel(e.target.value.trim())} />
        )}
      </div>
      <p className="text-xs text-muted dark:text-night-muted">
        {ar ? 'للتسجيل الصوتي الدقيق (Whisper) والمكالمة الصوتية يلزم مفتاح OpenAI حتى لو اخترت مزوّداً آخر للمحادثة. ' : 'Accurate voice input (Whisper) and live calls need an OpenAI key. '}
        {ar ? 'يُحفظ المفتاح على هذا الجهاز فقط. إن تركته فارغاً يُستخدم مفتاح الخادم (متغير بيئة في Vercel) إن وُجد. الموديل الفارغ يعني الافتراضي.' : 'The key stays on this device. If empty, the server key (a Vercel env variable) is used when set. An empty model means the default.'}
      </p>
      <button type="button" className="btn btn-primary w-full" onClick={save}>{ar ? 'حفظ' : 'Save'}</button>
    </section>
  );
}
