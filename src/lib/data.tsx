'use client';

import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useDashboardData } from './useDashboardData';
import { useExtraData } from './useExtraData';

type DashboardData = ReturnType<typeof useDashboardData> & ReturnType<typeof useExtraData>;
type DataContextValue = DashboardData & { userId: string; email: string };

const DataContext = createContext<DataContextValue | null>(null);

/** Loads wallets, rates, tasks and transactions once for every signed-in page. */
export function DataProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const data = useDashboardData(true, session.user.id);
  const extra = useExtraData(true, session.user.id);
  return (
    <DataContext.Provider value={{ ...data, ...extra, userId: session.user.id, email: session.user.email ?? '' }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}
