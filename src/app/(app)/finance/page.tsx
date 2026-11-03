'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { useData } from '@/lib/data';
import { FinanceNav } from '@/components/FinanceNav';
import { RateBar } from '@/components/RateBar';
import { BalanceCards } from '@/components/BalanceCards';
import { MonthSummary } from '@/components/MonthSummary';
import { RecentTransactions } from '@/components/RecentTransactions';
import { Converter } from '@/components/Converter';
import { WalletForm } from '@/components/WalletForm';
import { PendingInflows } from '@/components/PendingInflows';
import { PendingOutflows } from '@/components/PendingOutflows';
import { SafeBoundary } from '@/components/SafeBoundary';
import { ProjectsPanel } from '@/components/projects/ProjectsPanel';
import { px as tx } from '@/lib/ptext';
import type { Wallet } from '@/lib/types';

export default function FinancePage() {
  const { t, lang } = useApp();
  const [tab, setTab] = useState<'accounts' | 'projects'>('accounts');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'projects') setTab('projects');
  }, []);
  const data = useData();
  const [walletSheet, setWalletSheet] = useState<Wallet | null | undefined>(undefined);

  return (
    <>
      <FinanceNav />
      <div className="segmented mt-1" role="tablist">
        {(['accounts', 'projects'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {tx(lang, k === 'accounts' ? 'tabAccounts' : 'tabProjects')}
          </button>
        ))}
      </div>
      {tab === 'projects' ? (
        <div className="mt-3"><ProjectsPanel /></div>
      ) : (
      <>
      <div className="sticky top-0 z-20 -mx-4 bg-paper/85 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 dark:bg-night/85">
        <RateBar userId={data.userId} rateRows={data.rateRows} onSaved={data.loadRates} />
      </div>

      {data.error ? (
        <div className="card mt-2 text-center">
          <p className="mb-3 text-sm text-rose-600">{t('error')}: {data.error}</p>
          <button type="button" className="btn btn-primary" onClick={data.loadAll}>
            <RefreshCw className="size-4" aria-hidden /> {t('retry')}
          </button>
        </div>
      ) : data.loading && data.wallets.length === 0 ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-brand-600" aria-label={t('loading')} />
        </div>
      ) : (
        <div className="mt-2 grid w-full max-w-full grid-cols-1 gap-4 overflow-hidden lg:grid-cols-5">
          <div className="w-full min-w-0 max-w-full space-y-4 lg:col-span-3">
            <BalanceCards wallets={data.wallets} rates={data.rates} reserved={data.reserved} onAdd={() => setWalletSheet(null)} onEdit={(w) => setWalletSheet(w)} />
            <SafeBoundary><PendingInflows /></SafeBoundary>
            <SafeBoundary><PendingOutflows /></SafeBoundary>
            <MonthSummary txns={data.monthTxns} wallets={data.wallets} rates={data.rates} truncated={data.monthTruncated} />
            <RecentTransactions txns={data.recentTxns} wallets={data.wallets} limit={20} />
          </div>
          <div className="w-full min-w-0 max-w-full lg:col-span-2">
            <Converter wallets={data.wallets} rates={data.rates} onDone={data.refreshMoney} />
          </div>
        </div>
      )}

      </>
      )}

      {walletSheet !== undefined && (
        <WalletForm wallet={walletSheet} onClose={() => setWalletSheet(undefined)} onSaved={data.loadWallets} />
      )}
    </>
  );
}
