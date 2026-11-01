'use client';

import { useEffect, useState } from 'react';
import { Bell, Loader2, LogOut, MessageCircle, Send } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { px as tx, type AnyKey as TKey } from '@/lib/ptext';
import { DangerZone } from '@/components/settings/DangerZone';
import { AlarmSettings } from '@/components/settings/AlarmSettings';
import { notifPermission, notifSupported, requestNotifPermission, sendWhatsApp, showLocalNotification } from '@/lib/notify';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode: not persisted */ }
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${on ? 'bg-brand-500' : 'bg-slate-500/40'}`}>
      <span className={`absolute size-5 rounded-full bg-white shadow transition-all ${on ? 'start-6' : 'start-1'}`} />
    </button>
  );
}

const ALERT_KEYS: { key: string; label: TKey }[] = [
  { key: 'alert_low', label: 'aLow' },
  { key: 'alert_task24', label: 'aTask24' },
  { key: 'alert_daily', label: 'aDaily' },
];

export default function SettingsPage() {
  const { lang, theme, toggleLang, toggleTheme, notify } = useApp();
  const T = (k: TKey) => tx(lang, k);
  const { email, userId, profile, loadProfile, loadExtra } = useData();

  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [tg, setTg] = useState('');
  const [gaId, setGaId] = useState('');
  const [gaTok, setGaTok] = useState('');
  const [gaBusy, setGaBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [perm, setPerm] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default');
  const [waBusy, setWaBusy] = useState(false);

  useEffect(() => { setPerm(notifSupported() ? notifPermission() : 'unsupported'); }, []);

  async function enablePush() {
    const r = await requestNotifPermission();
    setPerm(r);
    if (r === 'granted') await showLocalNotification(T('pushTest'), T('pushGranted'), 'test');
  }

  async function testWa() {
    if (!profile?.whatsapp_phone || !profile?.green_api_id_instance || !profile?.green_api_token_instance) return notify(T('gaMissing'), 'error');
    setWaBusy(true);
    const r = await sendWhatsApp(T('msgTest'));
    setWaBusy(false);
    notify(r.ok ? T('waSent') : `${T('waFail')}${r.error ? ` (${r.error})` : ''}`, r.ok ? 'success' : 'error');
  }

  useEffect(() => {
    setName(profile?.display_name ?? '');
    setWa(profile?.whatsapp_phone ?? '');
    setTg(profile?.telegram_chat_id ?? '');
    setGaId(profile?.green_api_id_instance ?? '');
    setGaTok(profile?.green_api_token_instance ?? '');
  }, [profile]);

  useEffect(() => {
    const f: Record<string, boolean> = {};
    for (const k of ['auto_wa', 'auto_tg']) f[k] = readFlag(k, false);
    for (const a of ALERT_KEYS) f[a.key] = readFlag(a.key, true);
    setFlags(f);
  }, []);

  const setFlag = (key: string, on: boolean) => { writeFlag(key, on); setFlags((f) => ({ ...f, [key]: on })); };

  async function saveGreen() {
    if (!gaId.trim() || !gaTok.trim() || !wa.trim()) return notify(T('gaMissing'), 'error');
    setGaBusy(true);
    const { error } = await supabase().from('profiles').upsert(
      { user_id: userId, whatsapp_phone: wa.trim(), green_api_id_instance: gaId.trim(), green_api_token_instance: gaTok.trim() },
      { onConflict: 'user_id' },
    );
    setGaBusy(false);
    if (error) return notify(/column|schema cache/i.test(error.message) ? T('gaSqlMissing') : error.message, 'error');
    notify(T('saved'));
    await loadProfile().catch(() => loadExtra());
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase().from('profiles').upsert(
      { user_id: userId, display_name: name.trim() || null, whatsapp_phone: wa.trim() || null, telegram_chat_id: tg.trim() || null },
      { onConflict: 'user_id' },
    );
    setSaving(false);
    if (error) return notify(error.message, 'error');
    notify(T('saved'));
    await loadProfile().catch(() => loadExtra());
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-6">
      <form onSubmit={saveProfile} className="space-y-4">
        <section className="card space-y-4">
          <h2 className="text-base font-bold">{T('automation')}</h2>

          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-semibold"><MessageCircle className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden />{T('whatsapp')}</span>
            <Switch on={!!flags.auto_wa} onChange={(v) => setFlag('auto_wa', v)} label={T('whatsapp')} />
          </div>
          <input className="field num font-mono" dir="ltr" inputMode="tel" placeholder="+9715XXXXXXXX" aria-label={T('whatsappPhone')} value={wa} onChange={(e) => setWa(e.target.value)} />

          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-semibold"><Send className="size-5 text-sky-700 dark:text-sky-400" aria-hidden />{T('telegram')}</span>
            <Switch on={!!flags.auto_tg} onChange={(v) => setFlag('auto_tg', v)} label={T('telegram')} />
          </div>
          <input className="field num font-mono" dir="ltr" inputMode="numeric" placeholder="Chat ID" aria-label={T('telegramId')} value={tg} onChange={(e) => setTg(e.target.value)} />

          <label className="block">
            <span className="label">{T('displayName')}</span>
            <input className="field" value={name} placeholder={T('persona')} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" disabled={saving} className="btn btn-primary w-full">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
          </button>
        </section>
      </form>

      <section className="card space-y-3">
        <h2 className="flex items-center gap-2 text-base font-bold"><MessageCircle className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden />{T('gaTitle')}</h2>
        <label className="block"><span className="label">{T('gaId')}</span>
          <input className="field num font-mono" dir="ltr" inputMode="numeric" autoComplete="off" value={gaId} onChange={(e) => setGaId(e.target.value)} /></label>
        <label className="block"><span className="label">{T('gaToken')}</span>
          <input className="field font-mono" dir="ltr" type="password" autoComplete="off" value={gaTok} onChange={(e) => setGaTok(e.target.value)} /></label>
        <p className="text-xs text-muted dark:text-night-muted">{T('gaNote')}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={saveGreen} disabled={gaBusy} className="btn btn-primary">
            {gaBusy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('gaSave')}
          </button>
          <button type="button" onClick={testWa} disabled={waBusy} className="btn border border-line dark:border-night-line">
            {waBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />} {T('gaTest')}
          </button>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="flex items-center gap-2 text-base font-bold"><Bell className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />{T('pushTitle')}</h2>
        <p className="text-sm">{perm === 'granted' ? T('pushGranted') : perm === 'denied' ? T('pushDenied') : perm === 'unsupported' ? T('pushUnsupported') : T('pushNote')}</p>
        {perm === 'default' && (
          <button type="button" onClick={enablePush} className="btn btn-primary w-full">{T('pushEnable')}</button>
        )}
        {perm === 'granted' && (
          <button type="button" onClick={() => showLocalNotification(T('pushTest'), T('pushGranted'), 'test')} className="btn w-full border border-line dark:border-night-line">{T('pushTest')}</button>
        )}
        <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200">{T('pushNote')}</p>
      </section>

      <AlarmSettings />

      <section className="card space-y-4">
        <h2 className="text-base font-bold">{T('alertTypes')}</h2>
        {ALERT_KEYS.map((a) => (
          <div key={a.key} className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{T(a.label)}</span>
            <Switch on={!!flags[a.key]} onChange={(v) => setFlag(a.key, v)} label={T(a.label)} />
          </div>
        ))}
        <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200">{T('autoNote')}</p>
      </section>

      <section className="card space-y-5">
        <div>
          <span className="label">{T('language')}</span>
          <div className="segmented" role="group" aria-label={T('language')}>
            <button type="button" aria-pressed={lang === 'ar'} onClick={() => lang !== 'ar' && toggleLang()}>العربية</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => lang !== 'en' && toggleLang()}>English</button>
          </div>
        </div>
        <div>
          <span className="label">{T('theme')}</span>
          <div className="segmented" role="group" aria-label={T('theme')}>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()}>{T('dark')}</button>
            <button type="button" aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()}>{T('light')}</button>
          </div>
        </div>
      </section>

      <section className="card">
        <p className="text-xs font-semibold text-muted dark:text-night-muted">{T('signedInAs')}</p>
        <p className="mb-3 mt-0.5 break-all text-sm font-medium" dir="ltr">{email}</p>
        <button type="button" onClick={() => supabase().auth.signOut()} className="btn w-full border border-line text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 dark:border-night-line">
          <LogOut className="size-4 rtl:-scale-x-100" aria-hidden /> {T('signOut')}
        </button>
      </section>

      <DangerZone />

      <p className="text-center text-xs text-muted dark:text-night-muted">{T('persona')} · {T('version')} 0.3</p>
    </div>
  );
}
