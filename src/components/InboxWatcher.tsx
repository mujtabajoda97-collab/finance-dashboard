'use client';

import { useEffect, useRef } from 'react';
import { useApp } from './Providers';
import { useData } from '@/lib/data';
import { showLocalNotification } from '@/lib/notify';

const SEEN = 'wa_inbox_seen_v1';

/** Polls for new debtor replies and tells the owner (toast + system notification) once per reply. */
export function InboxWatcher() {
  const { lang, notify } = useApp();
  const { inbox, debts, loadInbox } = useData();
  const latest = useRef({ inbox, debts, lang });
  latest.current = { inbox, debts, lang };

  useEffect(() => {
    const id = window.setInterval(() => void loadInbox(), 60_000);
    return () => window.clearInterval(id);
  }, [loadInbox]);

  useEffect(() => {
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN) ?? '[]'); } catch { /* ignore */ }
    const fresh = inbox.filter((m) => !seen.includes(m.id));
    if (fresh.length === 0) return;
    try { localStorage.setItem(SEEN, JSON.stringify([...seen, ...fresh.map((m) => m.id)].slice(-200))); } catch { /* ignore */ }
    // The first load after installing would announce old replies: only announce replies from the last 2 days.
    for (const m of fresh.filter((x) => Date.now() - new Date(x.created_at).getTime() < 2 * 86_400_000)) {
      const who = latest.current.debts.find((d) => d.id === m.debt_id)?.person_name ?? '';
      const ar = latest.current.lang === 'ar';
      const title = ar ? `رد جديد من ${who}` : `New reply from ${who}`;
      const body = m.summary || m.body;
      notify(`${title}: ${body}`, 'warning');
      void showLocalNotification(title, body, `inbox:${m.id}`, '/debts/');
    }
  }, [inbox, notify]);

  return null;
}
