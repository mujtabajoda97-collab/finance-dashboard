'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { dictionaries, type DictKey, type Lang } from '@/lib/i18n';

type Theme = 'light' | 'dark';
type ToastKind = 'success' | 'error' | 'warning';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface AppContextValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: (key: DictKey) => string;
  toggleLang: () => void;
  theme: Theme;
  toggleTheme: () => void;
  notify: (text: string, kind?: ToastKind) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — preference just won't persist */
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('ar');
  const [theme, setTheme] = useState<Theme>('light');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  // Sync with what the no-flash script in <head> already applied.
  useEffect(() => {
    const storedLang = readStorage('lang');
    if (storedLang === 'en' || storedLang === 'ar') setLang(storedLang);
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b1412' : '#f6f4ef');
  }, [theme]);

  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next = l === 'ar' ? 'en' : 'ar';
      writeStorage('lang', next);
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((th) => {
      const next = th === 'dark' ? 'light' : 'dark';
      writeStorage('theme', next);
      return next;
    });
  }, []);

  const notify = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      t: (key) => dictionaries[lang][key] ?? key,
      toggleLang,
      theme,
      toggleTheme,
      notify,
    }),
    [lang, theme, toggleLang, toggleTheme, notify],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 lg:bottom-4 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-in pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
              toast.kind === 'error'
                ? 'bg-rose-600 text-white'
                : toast.kind === 'warning'
                  ? 'bg-amber-400 text-amber-950'
                  : 'bg-ink text-paper dark:bg-paper dark:text-ink'
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <Providers>');
  return ctx;
}
