'use client';

import { Settings2 } from 'lucide-react';
import { useApp } from './Providers';

export function SetupNotice() {
  const { t } = useApp();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <div className="card text-center">
        <Settings2 className="mx-auto mb-3 size-8 text-brand-600" aria-hidden />
        <h1 className="mb-2 text-lg font-bold">{t('setupTitle')}</h1>
        <p className="text-sm leading-relaxed text-muted dark:text-night-muted">{t('setupBody')}</p>
      </div>
    </main>
  );
}
