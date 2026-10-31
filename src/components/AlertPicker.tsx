'use client';

import { useApp } from './Providers';
import { MODES, type AlertChoice, type AlertMode } from '@/lib/alertPrefs';
import { tx, type TKey } from '@/lib/text';

const LABEL: Record<AlertMode, TKey> = { at: 'alertAt', '1h': 'alert1h', '2h': 'alert2h', '24h': 'alert24h', custom: 'alertCustom' };

export function AlertPicker({
  value,
  onChange,
  disabled = false,
  error = false,
}: {
  value: AlertChoice;
  onChange: (v: AlertChoice) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const { lang } = useApp();
  const T = (k: TKey) => tx(lang, k);
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-50">
      <legend className="label">{T('alertWhen')}</legend>
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value.mode === m}
            onClick={() => onChange({ ...value, mode: m })}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition aria-pressed:border-brand-500 aria-pressed:bg-brand-500 aria-pressed:text-white dark:border-night-line dark:text-night-muted dark:aria-pressed:text-night"
          >
            {T(LABEL[m])}
          </button>
        ))}
      </div>
      {value.mode === 'custom' && (
        <div>
          <input
            type="datetime-local"
            dir="ltr"
            aria-label={T('alertCustom')}
            className="field num w-full max-w-full font-mono"
            value={value.custom}
            onChange={(e) => onChange({ ...value, custom: e.target.value })}
          />
          {error && <p className="mt-1 text-xs font-semibold text-rose-700 dark:text-rose-400">{T('alertCustomErr')}</p>}
        </div>
      )}
    </fieldset>
  );
}
