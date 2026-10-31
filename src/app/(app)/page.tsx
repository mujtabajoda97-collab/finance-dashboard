'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { useData } from '@/lib/data';
import { tx } from '@/lib/text';
import { RateStrip } from '@/components/home/RateStrip';
import { CurrencyCards } from '@/components/home/CurrencyCards';
import { SudanQuick } from '@/components/home/SudanQuick';
import { DueAndTasks } from '@/components/home/DueAndTasks';
import { HomeProjects } from '@/components/home/HomeProjects';

export default function HomePage() {
  const { lang } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const data = useData();

  return (
    <>
      <RateStrip userId={data.userId} rateRows={data.rateRows} onSaved={async () => { await data.loadRates(); await data.loadRateHistory(); }} />

      {data.error ? (
        <div className="card mt-4 text-center">
          <p className="mb-3 text-sm text-rose-700 dark:text-rose-400">{T('error')}: {data.error}</p>
          <button type="button" className="btn btn-primary" onClick={data.loadAll}>
            <RefreshCw className="size-4" aria-hidden /> {T('retry')}
          </button>
        </div>
      ) : data.loading && data.wallets.length === 0 ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-brand-500" aria-label={T('loading')} />
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <CurrencyCards wallets={data.wallets} reserved={data.reserved} />
          <div className="grid gap-5 lg:grid-cols-2">
            <SudanQuick wallets={data.wallets} rates={data.rates} onDone={data.refreshMoney} />
            <DueAndTasks debts={data.debts} tasks={data.tasks} />
          </div>
          <HomeProjects />
        </div>
      )}

    </>
  );
}
