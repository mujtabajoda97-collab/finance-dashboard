'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { TopActions } from '@/components/TopActions';
import { SetupNotice } from '@/components/SetupNotice';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { px, type AnyKey } from '@/lib/ptext';

const RESEND_SECONDS = 60;

export default function LoginPage() {
  const { t, lang, notify } = useApp();
  const T = (k: AnyKey) => px(lang, k);
  const router = useRouter();
  const session = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  if (!isSupabaseConfigured) return <SetupNotice />;

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || wait > 0) return;
    setBusy(true);
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(T('otpSent'));
    setCode('');
    setWait(RESEND_SECONDS);
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.length < 6) return;
    setBusy(true);
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
    setBusy(false);
    if (error) {
      setCode('');
      return notify(T('otpInvalid'), 'error');
    }
    // useSession picks up the new session and redirects to the app.
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex justify-end py-3">
        <TopActions />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="mb-5 size-16 rounded-2xl shadow-sm" />
        <h1 className="text-2xl font-bold">{t('appName')}</h1>
        <p className="mb-8 text-sm text-muted dark:text-night-muted">{t('appTagline')}</p>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="card space-y-4">
            <h2 className="text-base font-bold">{T('otpTitle')}</h2>
            <div>
              <label htmlFor="email" className="label">{t('email')}</label>
              <input id="email" type="email" required autoComplete="email" dir="ltr" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || !email.trim()} className="btn btn-primary w-full py-3">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('otpSend')}
            </button>
            <p className="text-xs text-muted dark:text-night-muted">{T('otpHint')}</p>
          </form>
        ) : (
          <form onSubmit={verify} className="card space-y-4">
            <h2 className="text-base font-bold">{T('otpTitle')}</h2>
            <p className="text-sm text-muted dark:text-night-muted">{T('otpSent')}: <span dir="ltr" className="font-semibold text-ink dark:text-paper">{email}</span></p>
            <div>
              <label htmlFor="code" className="label">{T('otpCode')}</label>
              <input
                id="code"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,8}"
                maxLength={8}
                dir="ltr"
                className="field num text-center font-mono text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
            </div>
            <button type="submit" disabled={busy || code.length < 6} className="btn btn-primary w-full py-3">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('otpVerify')}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="font-semibold text-brand-600 dark:text-brand-400" onClick={() => setStep('email')}>{T('otpChange')}</button>
              <button type="button" disabled={wait > 0 || busy} className="font-semibold text-brand-600 disabled:opacity-50 dark:text-brand-400" onClick={() => sendCode()}>
                {wait > 0 ? `${T('otpWait')} ${wait}` : T('otpResend')}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
