/**
 * Speech in / out for the assistant.
 *  - Android app: native plugins (@capacitor-community/speech-recognition and text-to-speech), reached at runtime through
 *    window.Capacitor (never imported). Android WebView has NO Web Speech recognition, so the native plugin is required there.
 *  - Browsers (Chrome / Edge / Safari): the Web Speech API.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  registerPlugin?: (name: string) => unknown;
}
interface SpeechPlugin {
  available(): Promise<{ available: boolean }>;
  checkPermissions?(): Promise<{ speechRecognition?: string }>;
  requestPermissions?(): Promise<{ speechRecognition?: string }>;
  start(o: { language?: string; maxResults?: number; prompt?: string; partialResults?: boolean; popup?: boolean }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
}
interface TtsPlugin {
  speak(o: { text: string; lang?: string; rate?: number; pitch?: number; volume?: number; category?: string }): Promise<void>;
  stop(): Promise<void>;
}
interface WebSR {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

const cap = (): CapacitorGlobal | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor);
const native = () => {
  try { return !!cap()?.isNativePlatform?.(); } catch { return false; }
};
function nativePlugin<T>(name: string): T | null {
  try {
    const c = cap();
    if (!c || !native()) return null;
    return (c.Plugins?.[name] ?? c.registerPlugin?.(name) ?? null) as T | null;
  } catch {
    return null;
  }
}
const webSR = (): (new () => WebSR) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => WebSR; webkitSpeechRecognition?: new () => WebSR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export type VoiceError = 'unsupported' | 'denied' | 'no-speech' | 'failed';
export class VoiceFail extends Error {
  constructor(public code: VoiceError) {
    super(code);
  }
}

let webRec: WebSR | null = null;
let nativeListening = false;

/** One spoken sentence -> text. Rejects with VoiceFail. */
export async function listenOnce(lang: 'ar' | 'en'): Promise<string> {
  const language = lang === 'ar' ? 'ar-AE' : 'en-US';
  const sp = nativePlugin<SpeechPlugin>('SpeechRecognition');
  if (sp) {
    try {
      if (!(await sp.available())?.available) throw new VoiceFail('unsupported');
      const perm = (await sp.checkPermissions?.())?.speechRecognition;
      if (perm !== 'granted') {
        const asked = (await sp.requestPermissions?.())?.speechRecognition;
        if (asked !== 'granted') throw new VoiceFail('denied');
      }
      nativeListening = true;
      const res = await sp.start({ language, maxResults: 1, partialResults: false, popup: false, prompt: lang === 'ar' ? 'تكلّم الآن' : 'Speak now' });
      const text = (res?.matches?.[0] ?? '').trim();
      if (!text) throw new VoiceFail('no-speech');
      return text;
    } catch (e) {
      if (e instanceof VoiceFail) throw e;
      const m = String((e as Error)?.message ?? e).toLowerCase();
      throw new VoiceFail(m.includes('permission') || m.includes('denied') ? 'denied' : m.includes('no match') || m.includes('speech') ? 'no-speech' : 'failed');
    } finally {
      nativeListening = false;
    }
  }
  const Ctor = webSR();
  if (!Ctor || native()) throw new VoiceFail('unsupported');
  return new Promise<string>((resolve, reject) => {
    const r = new Ctor();
    let got = '';
    r.lang = language;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => { got = (e.results[0]?.[0]?.transcript ?? '').trim(); };
    r.onerror = (e) => reject(new VoiceFail(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'no-speech' : 'failed'));
    r.onend = () => { webRec = null; got ? resolve(got) : reject(new VoiceFail('no-speech')); };
    webRec = r;
    try { r.start(); } catch { webRec = null; reject(new VoiceFail('failed')); }
  });
}

export function stopListening(): void {
  try { webRec?.stop(); } catch { /* ignore */ }
  if (nativeListening) void nativePlugin<SpeechPlugin>('SpeechRecognition')?.stop().catch(() => undefined);
}

/** Plain text for the voice: no markdown marks, links or emoji, and only the first ~500 characters. */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#`>|~]/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export async function speak(text: string, lang: 'ar' | 'en'): Promise<void> {
  const t = speakable(text);
  if (!t) return;
  const language = lang === 'ar' ? 'ar-SA' : 'en-US';
  const tts = nativePlugin<TtsPlugin>('TextToSpeech');
  if (tts) {
    try {
      await tts.stop().catch(() => undefined);
      await tts.speak({ text: t, lang: language, rate: 1, pitch: 1, volume: 1, category: 'ambient' });
      return;
    } catch {
      /* fall back to the web voice */
    }
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) throw new VoiceFail('unsupported');
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = language;
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking(): void {
  try { void nativePlugin<TtsPlugin>('TextToSpeech')?.stop().catch(() => undefined); } catch { /* ignore */ }
  try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

const AUTO = 'ai_autospeak_v1';
export const getAutoSpeak = (): boolean => { try { return localStorage.getItem(AUTO) === '1'; } catch { return false; } };
export const setAutoSpeak = (v: boolean): void => { try { v ? localStorage.setItem(AUTO, '1') : localStorage.removeItem(AUTO); } catch { /* ignore */ } };
