export type AiProvider = 'gemini' | 'openai' | 'anthropic';
export const PROVIDERS: { id: AiProvider; label: string; model: string; hint: string }[] = [
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-3.8-flash', hint: 'AIza…' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', hint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-3-5-haiku-20241022', hint: 'sk-ant-…' },
];

/** Default OpenAI list, newest/smartest first down to fastest/lightest. */
export const OPENAI_MODELS: { id: string; ar: string; en: string }[] = [
  { id: 'gpt-4o', ar: 'أعلى دقة للتحليلات المعقدة', en: 'highest accuracy' },
  { id: 'gpt-4o-mini', ar: 'سريع واقتصادي للاستخدام اليومي', en: 'fast and cheap' },
  { id: 'o1-preview', ar: 'تفكير منطقي وحسابات', en: 'reasoning' },
  { id: 'o1-mini', ar: 'تفكير منطقي أخف', en: 'light reasoning' },
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
export const getAiModel = (p: AiProvider = getProvider()): string => read(M(p)).trim();
export const setAiModel = (p: AiProvider, v: string): void => write(M(p), v.trim());
/** Backwards compatible names. */
export const getGeminiKey = (): string => getAiKey('gemini');
export const setGeminiKey = (v: string): void => setAiKey('gemini', v);
