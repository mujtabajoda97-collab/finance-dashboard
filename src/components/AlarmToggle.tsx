'use client';

import { BellRing } from 'lucide-react';
import { useApp } from './Providers';
import { px } from '@/lib/ptext';

/** Per-item optional voice alarm switch used by tasks, debts and project items. */
export function AlarmToggle({
  on,
  onChange,
  note,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  /** Extra line under the label, e.g. when the alarm rings. */
  note?: string;
  disabled?: boolean;
}) {
  const { lang } = useApp();
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-line p-3 dark:border-night-line ${disabled ? 'opacity-50' : ''}`}>
      <BellRing className={`mt-0.5 size-5 shrink-0 ${on ? 'text-brand-600 dark:text-brand-400' : 'text-muted dark:text-night-muted'}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{px(lang, 'alarmLabel')}</p>
        <p className="text-[11px] text-muted dark:text-night-muted">{px(lang, 'alarmHint')}</p>
        {note && <p className="mt-0.5 text-[11px] text-muted dark:text-night-muted">{note}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={px(lang, 'alarmLabel')}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${on ? 'bg-brand-500' : 'bg-slate-500/40'}`}
      >
        <span className={`absolute size-5 rounded-full bg-white shadow transition-all ${on ? 'start-6' : 'start-1'}`} />
      </button>
    </div>
  );
}
