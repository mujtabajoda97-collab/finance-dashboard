'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useApp } from './Providers';
import { supabase } from '@/lib/supabase';
import { lockAvailable, lockEnabled, promptUnlock } from '@/lib/biometric';
import { p2 as px } from '@/lib/ptext2';
import { tx } from '@/lib/text';

/**
 * Optional app lock (Android app). When switched on in Settings, the app asks for the fingerprint or the
 * phone screen lock when it opens and every time it returns from the background. Until then nothing is shown.
 * If the phone has no usable lock (or the plugin is missing) it stays open instead of locking the owner out.
 */
export function AppLock({ children }: { children: React.ReactNode }) {
  const { lang } = useApp();
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const busy = useRef(false);
  const quietUntil = useRef(0);
  const wasHidden = useRef(false);
  const langRef = useRef(lang);
  langRef.current = lang;

  const attempt = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const ok = await promptUnlock(px(langRef.current, 'lockedHeading'), px(langRef.current, 'lockPrompt'));
    busy.current = false;
    // The system prompt itself makes the page go hidden/visible: ignore those events for a moment.
    quietUntil.current = Date.now() + (ok ? 2500 : 1500);
    if (ok) setState('open');
  }, []);

  // Cold start.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!lockEnabled() || !(await lockAvailable())) { if (alive) setState('open'); return; }
      if (!alive) return;
      setState('locked');
      void attempt();
    })();
    return () => { alive = false; };
  }, [attempt]);

  // Coming back from the background.
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === 'hidden') { wasHidden.current = true; return; }
      if (!wasHidden.current || busy.current || Date.now() < quietUntil.current) return;
      wasHidden.current = false;
      if (!lockEnabled() || !(await lockAvailable())) return;
      setState('locked');
      void attempt();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [attempt]);

  if (state === 'checking') {
    return <div className="min-h-dvh bg-paper dark:bg-night" aria-busy="true" />;
  }

  return (
    <>
      <div hidden={state === 'locked'}>{children}</div>
      {state === 'locked' && (
        <div role="dialog" aria-modal="true" aria-label={px(lang, 'lockedHeading')}
          className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 bg-paper p-6 text-center dark:bg-night">
          <Lock className="size-14 text-brand-500" aria-hidden />
          <h1 className="text-xl font-bold">{px(lang, 'lockedHeading')}</h1>
          <p className="max-w-xs text-sm text-muted dark:text-night-muted">{px(lang, 'lockPrompt')}</p>
          <button type="button" onClick={() => void attempt()} className="btn btn-primary w-full max-w-xs py-3">{px(lang, 'lockUnlock')}</button>
          <button type="button" onClick={() => supabase().auth.signOut()} className="text-sm font-semibold text-rose-600 dark:text-rose-400">{tx(lang, 'signOut')}</button>
        </div>
      )}
    </>
  );
}
