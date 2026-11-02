'use client';

import { useEffect, useRef } from 'react';
import { useApp } from './Providers';
import { p2 as tx } from '@/lib/ptext2';
import type { Recipient } from '@/lib/recipient';

/**
 * "Send to another number": a friendly starting text appears in the box and follows the title / amount / name
 * until the user types in it. After that it is fully theirs: any wording, or empty and rewritten from scratch.
 */
export function RecipientField({
  value,
  onChange,
  suggested,
  defaultName = '',
  disabled = false,
}: {
  value: Recipient;
  onChange: (v: Recipient) => void;
  /** Current suggested text (already filled with the name / amount / title). */
  suggested: string;
  /** Used as the recipient name until the user types another one. */
  defaultName?: string;
  disabled?: boolean;
}) {
  const { lang } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  // Follow the suggestion only while the box still holds the previous suggestion (or nothing yet).
  const lastSuggested = useRef<string | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    const { value: v, onChange: change } = latest.current;
    if (!v.on) return;
    const untouched = v.text === '' ? lastSuggested.current === null : v.text === lastSuggested.current;
    if (untouched && v.text !== suggested) change({ ...v, text: suggested });
    lastSuggested.current = suggested;
  }, [suggested, value.on]);

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-50">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-brand-500" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        {T('recipSend')}
      </label>
      {value.on && (
        <div className="space-y-2 rounded-2xl border border-line p-3 dark:border-night-line">
          <label className="block"><span className="label">{T('recipName')}</span>
            <input className="field" value={value.name} placeholder={defaultName} onChange={(e) => onChange({ ...value, name: e.target.value })} /></label>
          <label className="block"><span className="label">{T('recipPhone')}</span>
            <input className="field num font-mono" dir="ltr" inputMode="tel" placeholder="+9715XXXXXXXX" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></label>
          <label className="block"><span className="label">{T('recipText')}</span>
            <textarea className="field min-h-28 leading-relaxed" rows={4} maxLength={900} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} /></label>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted dark:text-night-muted">{T('recipNote')}</p>
            <button type="button" className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-400" onClick={() => { lastSuggested.current = suggested; onChange({ ...value, text: suggested }); }}>
              {T('recipReset')}
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
