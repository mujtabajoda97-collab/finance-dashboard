'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './Providers';
import type { DictKey } from '@/lib/i18n';

const TABS: { href: string; label: DictKey }[] = [
  { href: '/finance', label: 'fnOverview' },
  { href: '/finance/transactions', label: 'fnTransactions' },
];

export function FinanceNav() {
  const { t } = useApp();
  const path = (usePathname() ?? '').replace(/\/+$/, '') || '/';
  return (
    <nav aria-label="finance" className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 rounded-2xl bg-paper p-1 dark:bg-night">
        {TABS.map(({ href, label }) => {
          const active = path === href;
          return (
            <li key={href}>
              <Link
                href={`${href}/`}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-card text-brand-700 shadow-sm dark:bg-night-card dark:text-brand-400'
                    : 'text-muted hover:text-ink dark:text-night-muted dark:hover:text-paper'
                }`}
              >
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
