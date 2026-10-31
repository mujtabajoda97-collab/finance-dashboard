'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Coins, ListChecks, LayoutDashboard, LogOut, Moon, Settings, Sun, TrendingUp, Wallet } from 'lucide-react';
import { useApp } from './Providers';
import { APP_TZ, intlLocale } from '@/lib/time';
import { AlertEngine } from './AlertEngine';
import { supabase } from '@/lib/supabase';
import { useData } from '@/lib/data';
import { liveAlerts } from '@/lib/derived';
import { tx, type TKey } from '@/lib/text';

const NAV: { href: string; label: TKey; title: TKey; icon: typeof Wallet }[] = [
  { href: '/', label: 'home', title: 'persona', icon: LayoutDashboard },
  { href: '/finance/', label: 'finance', title: 'financeTitle', icon: Wallet },
  { href: '/debts/', label: 'debts', title: 'debtsTitle', icon: Coins },
  { href: '/tasks/', label: 'tasks', title: 'tasksTitle', icon: ListChecks },
  { href: '/reports/', label: 'reports', title: 'reportsTitle', icon: TrendingUp },
  { href: '/settings/', label: 'settings', title: 'settingsTitle', icon: Settings },
];
// Pages reachable from inside the app but not a tab of their own.
const EXTRA_TITLES: Record<string, TKey> = { '/rates': 'ratesTitle' };

const trim = (p: string) => p.replace(/\/+$/, '') || '/';
const isActive = (href: string, path: string) => {
  const h = trim(href);
  return h === '/' ? path === '/' : path === h || path.startsWith(`${h}/`);
};

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const { lang, t, theme, toggleLang, toggleTheme } = useApp();
  const T = (k: TKey) => tx(lang, k);
  const path = trim(usePathname() ?? '/');
  const { wallets, tasks, debts, profile } = useData();
  const current = NAV.find((n) => isActive(n.href, path));
  const titleKey: TKey = current ? current.title : EXTRA_TITLES[path] ?? 'persona';
  const heading = titleKey === 'persona' ? profile?.display_name?.trim() || T('persona') : T(titleKey);
  const badge = liveAlerts(wallets, tasks, debts).length;

  const date = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const signOut = () => supabase().auth.signOut();

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip lg:ps-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-card px-4 py-5 lg:flex dark:border-night-line dark:bg-night-card">
        <div className="mb-8 flex items-center gap-3 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-10 rounded-xl" />
          <span className="text-base font-bold leading-tight">{T('persona')}</span>
        </div>
        <nav aria-label="main" className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href, path);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400'
                    : 'text-muted hover:bg-paper hover:text-ink dark:text-night-muted dark:hover:bg-night dark:hover:text-paper'
                }`}
              >
                <Icon className="size-5" aria-hidden />
                {T(label)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line pt-4 dark:border-night-line">
          <p className="mb-2 truncate px-2 text-xs text-muted dark:text-night-muted" dir="ltr">{email}</p>
          <button type="button" onClick={signOut} className="btn btn-ghost w-full justify-start px-3">
            <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
            {T('signOut')}
          </button>
        </div>
      </aside>

      <div className="mx-auto w-full max-w-5xl min-w-0 px-4 pb-28 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 lg:pb-10">
        <header className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted dark:text-night-muted">{date}</p>
            <h1 className="truncate text-xl font-bold">{heading}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={toggleLang} className="icon-btn text-xs font-bold" aria-label={t('toggleLang')} title={t('toggleLang')}>
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <button type="button" onClick={toggleTheme} className="icon-btn" aria-label={t('toggleTheme')} title={t('toggleTheme')}>
              {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            </button>
            <Link href="/settings/" className="icon-btn" aria-label={T('settings')}>
              <Settings className="size-4" aria-hidden />
            </Link>
            <Link href="/debts/#alerts" className="icon-btn relative" aria-label={T('notifications')}>
              <Bell className="size-4" aria-hidden />
              {badge > 0 && (
                <span className="num absolute -end-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </Link>
          </div>
        </header>
        {children}
      </div>
      <AlertEngine />

      {/* Mobile bottom navigation */}
      <nav
        aria-label="main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur lg:hidden dark:border-night-line dark:bg-[#0a1f19]/95"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-6">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href, path);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${
                    active ? 'text-brand-600 dark:text-brand-400' : 'text-muted dark:text-night-muted'
                  }`}
                >
                  <Icon className="size-5" aria-hidden />
                  {T(label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
