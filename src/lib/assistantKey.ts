const KEY = 'gemini_key_v1';
/** Optional personal Gemini key, kept on this device only (the server falls back to its own GEMINI_API_KEY). */
export const getGeminiKey = (): string => {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setGeminiKey = (v: string): void => {
  try { v.trim() ? localStorage.setItem(KEY, v.trim()) : localStorage.removeItem(KEY); } catch { /* ignore */ }
};
