'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { TopActions } from '@/components/TopActions';
import { SetupNotice } from '@/components/SetupNotice';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { px, type AnyKey } from '@/lib/ptext';
import { biometricAvailable, biometricCredentials, biometricEnabled } from '@/lib/biometric';

const RESEND_SECONDS = 60;

export default function LoginPage() {
  const { t, lang, notify } = useApp();
  const T = (k: AnyKey) => px(lang, k);
  const router = useRouter();
  const session = useSession();
  // login: email + password (default). email/code: one-time verification (new account or forgot password).
  // password: mandatory "choose a password" step right after the code.
  const [step, setStep] = useState<'login' | 'email' | 'code' | 'password'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [bio, setBio] = useState(false);
  // While true the page must NOT redirect: the OTP created a session but the password is not set yet.
  const holdRedirect = useRef(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session && !holdRedirect.current && step !== 'password') router.replace('/');
  }, [session, router, step]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!biometricEnabled()) return;
      if (await biometricAvailable()) { if (alive) setBio(true); }
    })();
    return () => { alive = false; };
  }, []);

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
    holdRedirect.current = true; // the session appears before the password is chosen
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
    setBusy(false);
    if (error) {
      holdRedirect.current = false;
      setCode('');
      return notify(T('otpInvalid'), 'error');
    }
    setPw1('');
    setPw2('');
    setStep('password');
  }

  async function signIn(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    const em = (creds?.email ?? email).trim();
    const pw = creds?.password ?? password;
    if (busy || !em || !pw) return;
    setBusy(true);
    const { error } = await supabase().auth.signInWithPassword({ email: em, password: pw });
    setBusy(false);
    if (error) return notify(T('loginBad'), 'error');
    // useSession picks up the new session and redirects to the app.
  }

  async function signInBio() {
    const c = await biometricCredentials(T('bioLogin'));
    if (!c) return notify(T('bioFail'), 'error');
    await signIn(undefined, c);
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw1.length < 8) return notify(T('pwMin'), 'error');
    if (pw1 !== pw2) return notify(T('pwMismatch'), 'error');
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    holdRedirect.current = false;
    router.replace('/');
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

        {step === 'login' ? (
          <form onSubmit={(e) => signIn(e)} className="card space-y-4">
            <h2 className="text-base font-bold">{T('loginTitle')}</h2>
            <div>
              <label htmlFor="email" className="label">{T('loginEmail')}</label>
              <input id="email" type="email" required autoComplete="username" dir="ltr" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="password" className="label">{T('loginPassword')}</label>
              <input id="password" type="password" required autoComplete="current-password" dir="ltr" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || !email.trim() || !password} className="btn btn-primary w-full py-3">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('loginBtn')}
            </button>
            {bio && (
              <button type="button" disabled={busy} onClick={signInBio} className="btn w-full border border-line py-3 dark:border-night-line">
                <Fingerprint className="size-5" aria-hidden /> {T('bioLogin')}
              </button>
            )}
            <p className="text-xs text-muted dark:text-night-muted">{T('loginNoUsername')}</p>
            <button type="button" className="text-sm font-semibold text-brand-600 dark:text-brand-400" onClick={() => setStep('email')}>{T('forgotPw')}</button>
          </form>
        ) : step === 'password' ? (
          <form onSubmit={savePassword} className="card space-y-4">
            <h2 className="text-base font-bold">{T('setPwTitle')}</h2>
            <p className="text-sm text-muted dark:text-night-muted">{T('setPwHint')}</p>
            <div>
              <label htmlFor="pw1" className="label">{T('pwNew')}</label>
              <input id="pw1" type="password" required minLength={8} autoComplete="new-password" dir="ltr" className="field" value={pw1} onChange={(e) => setPw1(e.target.value)} />
            </div>
            <div>
              <label htmlFor="pw2" className="label">{T('pwConfirm')}</label>
              <input id="pw2" type="password" required minLength={8} autoComplete="new-password" dir="ltr" className="field" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || pw1.length < 8 || pw1 !== pw2} className="btn btn-primary w-full py-3">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('pwSave')}
            </button>
          </form>
        ) : step === 'email' ? (
          <form onSubmit={sendCode} className="card space-y-4">
            <h2 className="text-base font-bold">{T('signupTitle')}</h2>
            <div>
              <label htmlFor="email" className="label">{t('email')}</label>
              <input id="email" type="email" required autoComplete="email" dir="ltr" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" disabled={busy || !email.trim()} className="btn btn-primary w-full py-3">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('otpSend')}
            </button>
            <p className="text-xs text-muted dark:text-night-muted">{T('signupHint')}</p>
            <button type="button" className="text-sm font-semibold text-brand-600 dark:text-brand-400" onClick={() => setStep('login')}>{T('backToLogin')}</button>
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
