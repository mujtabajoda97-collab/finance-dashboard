import { supabase } from './supabase';
import { VoiceFail } from './voice';

/**
 * Real audio recording (MediaRecorder) with a live level meter and optional stop-on-silence,
 * and Whisper transcription through /api/whisper. Used instead of the browser's own recognizer.
 */
export interface RecResult { blob: Blob | null; heard: boolean }
export interface RecSession {
  done: Promise<RecResult>;
  /** Finish and keep the audio. */
  stop(): void;
  /** Finish and drop the audio. */
  cancel(): void;
}
interface Opts {
  /** Receives a 0..1 level about every 70 ms (for the waveform). */
  level?: { current: number };
  /** Stop automatically after this much silence once speech was heard. */
  silenceMs?: number;
  /** Give up if nothing was said within this time. */
  idleMs?: number;
  maxMs?: number;
}

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const SPEECH = 0.045;

export async function recordSpeech(o: Opts): Promise<RecSession> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new VoiceFail('unsupported');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const n = (e as DOMException)?.name;
    throw new VoiceFail(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : 'unsupported');
  }
  const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      ctx = new AC();
      void ctx.resume().catch(() => undefined);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
    }
  } catch { /* meter is optional */ }

  const buf = new Uint8Array(analyser?.fftSize ?? 0);
  const started = Date.now();
  let heard = false;
  let lastVoice = started;
  let keep = true;
  let finished = false;
  let resolveDone!: (r: RecResult) => void;
  const done = new Promise<RecResult>((r) => { resolveDone = r; });

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    if (o.level) o.level.current = 0;
    if (mr.state !== 'inactive') mr.stop();
    else resolveDone({ blob: null, heard });
  };
  mr.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => undefined);
    resolveDone({ blob: keep && chunks.length ? new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' }) : null, heard });
  };

  const timer = setInterval(() => {
    const now = Date.now();
    let lvl = 0;
    if (analyser) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      if (o.level) o.level.current = lvl;
      if (lvl > SPEECH * 4) { heard = true; lastVoice = now; }
    }
    if (o.silenceMs && heard && now - lastVoice > o.silenceMs) finish();
    else if (o.idleMs && !heard && analyser && now - started > o.idleMs) { keep = false; finish(); }
    else if (now - started > (o.maxMs ?? 60_000)) finish();
  }, 70);

  mr.start(250);
  return {
    done,
    stop: finish,
    cancel: () => { keep = false; finish(); },
  };
}

let serverKey: boolean | null = null;
/** Whisper needs an OpenAI key: the one typed in Settings, or one set on the server. */
export async function whisperAvailable(localKey: string): Promise<boolean> {
  if (localKey) return true;
  if (serverKey !== null) return serverKey;
  try {
    const { data } = await supabase().auth.getSession();
    const r = await fetch('/api/whisper/', { headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` }, cache: 'no-store' });
    const j = (await r.json()) as { serverKey?: boolean };
    serverKey = !!j.serverKey;
  } catch {
    serverKey = false;
  }
  return serverKey;
}

/** Audio -> text with OpenAI Whisper. Throws Error(message) in the user's language-neutral form. */
export async function transcribe(blob: Blob, lang: 'ar' | 'en', apiKey: string): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const fd = new FormData();
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('audio', blob, `speech.${ext}`);
  fd.append('lang', lang);
  if (apiKey) fd.append('apiKey', apiKey);
  const r = await fetch('/api/whisper/', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` }, body: fd });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string; detail?: string };
  if (j.ok) {
    const t = (j.text ?? '').trim();
    if (!t) throw new VoiceFail('no-speech');
    return t;
  }
  const ar = lang === 'ar';
  const map: Record<string, string> = {
    'no-key': ar ? 'أضف مفتاح OpenAI في الإعدادات ← المساعد الذكي لاستخدام التسجيل الصوتي الدقيق.' : 'Add an OpenAI key in Settings for accurate voice input.',
    'key-rejected': ar ? 'رفضت OpenAI المفتاح. تحقق منه في الإعدادات.' : 'OpenAI rejected the key.',
    quota: ar ? 'رصيد OpenAI غير كافٍ أو تجاوزت الحد.' : 'OpenAI quota exceeded.',
    'too-large': ar ? 'التسجيل طويل جداً، قصّره.' : 'Recording too long.',
    unauthorized: ar ? 'انتهت الجلسة، سجّل الدخول من جديد.' : 'Session expired.',
  };
  throw new Error((map[j.error ?? ''] ?? (ar ? 'تعذّر تفريغ الصوت.' : 'Transcription failed.')) + (j.detail ? `\n(${j.detail})` : ''));
}
