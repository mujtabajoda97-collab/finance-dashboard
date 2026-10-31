'use client';

import { Languages, LogOut, Moon, Sun } from 'lucide-react';
import { useApp } from './Providers';

export function TopActions({ onSignOut }: { onSignOut?: () => void }) {
  const { t, theme, toggleTheme, toggleLang } = useApp();
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={toggleLang} className="icon-btn w-auto px-3 text-sm font-semibold" aria-label={t('toggleLang')}>
        <Languages className="size-4" aria-hidden />
        <span>{t('toggleLang')}</span>
      </button>
      <button type="button" onClick={toggleTheme} className="icon-btn" aria-label={t('toggleTheme')} title={t('toggleTheme')}>
        {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </button>
      {onSignOut && (
        <button type="button" onClick={onSignOut} className="icon-btn" aria-label={t('signOut')} title={t('signOut')}>
          <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
        </button>
      )}
    </div>
  );
}
