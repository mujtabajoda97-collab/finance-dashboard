export type AiProvider = 'gemini' | 'openai' | 'anthropic';
export const PROVIDERS: { id: AiProvider; label: string; model: string; hint: string }[] = [
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-3.8-flash', hint: 'AIza…' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', hint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-3-5-haiku-20241022', hint: 'sk-ant-…' },
];

/** Built-in model lists, newest / smartest first down to fastest / lightest. The user can also type any model name. */
export interface ModelInfo { id: string; ar: string; en: string }
export const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', ar: 'أعلى دقة للتحليلات المعقدة', en: 'highest accuracy' },
  { id: 'gpt-4o-mini', ar: 'سريع واقتصادي للاستخدام اليومي', en: 'fast and cheap' },
  { id: 'o1', ar: 'تفكير منطقي وحسابات', en: 'reasoning' },
  { id: 'o1-mini', ar: 'تفكير منطقي أخف', en: 'light reasoning' },
  { id: 'chatgpt-4o-latest', ar: 'أحدث نسخة 4o', en: 'latest 4o' },
  { id: 'gpt-4-turbo', ar: 'قوي', en: 'strong' },
  { id: 'gpt-4.1', ar: 'ذكي ودقيق', en: 'smart and precise' },
  { id: 'gpt-4.1-mini', ar: 'متوازن', en: 'balanced' },
  { id: 'gpt-4.1-nano', ar: 'الأخف', en: 'lightest' },
  { id: 'o3-mini', ar: 'تفكير منطقي سريع', en: 'fast reasoning' },
  { id: 'o1-preview', ar: 'تفكير منطقي (معاينة)', en: 'reasoning preview' },
  { id: 'gpt-3.5-turbo', ar: 'قديم واقتصادي', en: 'legacy, cheap' },
];
export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-3-5-sonnet-20241022', ar: 'Sonnet 3.5 (رسمي)', en: 'Sonnet 3.5' },
  { id: 'claude-3-5-haiku-20241022', ar: 'Haiku 3.5 (رسمي)', en: 'Haiku 3.5' },
  { id: 'claude-3-opus-20240229', ar: 'Opus 3 (رسمي)', en: 'Opus 3' },
  { id: 'claude-opus-4-1-20250805', ar: 'Opus 4.1', en: 'Opus 4.1' },
  { id: 'claude-sonnet-4-20250514', ar: 'Sonnet 4', en: 'Sonnet 4' },
  { id: 'claude-3-7-sonnet-latest', ar: 'Sonnet 3.7', en: 'Sonnet 3.7' },
  { id: 'claude-3-haiku-20240307', ar: 'Haiku 3 (الأخف)', en: 'Haiku 3' },
];

const P = 'ai_provider_v1';
const K = (p: AiProvider) => (p === 'gemini' ? 'gemini_key_v1' : `ai_key_${p}_v1`);
const M = (p: AiProvider) => `ai_model_${p}_v1`;
const strip = (v: string) => v.replace(/["'\s]/g, '');
const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };

/** Chosen provider, its key and optional model, kept on this device only. The server falls back to its own env keys. */
export const getProvider = (): AiProvider => {
  const v = read(P);
  return v === 'openai' || v === 'anthropic' ? v : 'gemini';
};
export const setProvider = (p: AiProvider): void => write(P, p);
export const getAiKey = (p: AiProvider = getProvider()): string => strip(read(K(p)));
export const setAiKey = (p: AiProvider, v: string): void => write(K(p), strip(v));
export const getAiModel = (p: AiProvider = getProvider()): string => {
  const v = read(M(p)).trim();
  // names saved by an earlier version of the app that Anthropic rejects: fall back to the default
  return p === 'anthropic' && /^claude-(fable|opus|sonnet|haiku)-5-/.test(v) ? '' : v;
};
export const setAiModel = (p: AiProvider, v: string): void => write(M(p), v.trim());
/** Backwards compatible names. */
export const getGeminiKey = (): string => getAiKey('gemini');
export const setGeminiKey = (v: string): void => setAiKey('gemini', v);
