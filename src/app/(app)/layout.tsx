'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';
import { AppLock } from '@/components/AppLock';
import { InboxWatcher } from '@/components/InboxWatcher';
import { Assistant } from '@/components/Assistant';
import { SetupNotice } from '@/components/SetupNotice';
import { DataProvider } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';

/** Auth gate + shared data for every signed-in page. RLS is the real protection; this is UX. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useApp();
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session === null && isSupabaseConfigured) router.replace('/login');
  }, [session, router]);

  if (!isSupabaseConfigured) return <SetupNotice />;

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-600" aria-label={t('loading')} />
      </div>
    );
  }

  return (
    <DataProvider session={session}>
      <AppLock>
        <AppShell email={session.user.email ?? ''}>{children}</AppShell>
        <Assistant />
        <InboxWatcher />
      </AppLock>
    </DataProvider>
  );
}
