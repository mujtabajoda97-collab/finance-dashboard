'use client';

import { useApp } from '../Providers';
import { tx } from '@/lib/text';
import type { Priority } from '@/lib/types';

const STYLE: Record<Priority, string> = {
  CRITICAL: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-400/40',
  HIGH: 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-400/40',
  MEDIUM: 'bg-amber-400/20 text-amber-800 dark:text-amber-300 border-amber-300/40',
  LOW: 'bg-slate-400/15 text-slate-700 dark:text-slate-300 border-slate-400/30',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { lang } = useApp();
  return <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${STYLE[priority]}`}>{tx(lang, priority)}</span>;
}
