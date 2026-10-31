-- =====================================================================
-- Optional: schedule alert generation inside Supabase with pg_cron.
-- Enable "pg_cron" from Database → Extensions first.
-- Times are UTC (Dubai = UTC+4).
-- Skip this file if you prefer to drive the schedule from n8n instead.
-- =====================================================================
create extension if not exists pg_cron;

-- Every 15 minutes: upcoming tasks, overdue tasks (throttled), due debts.
select cron.schedule('due-alerts', '*/15 * * * *', $$select public.generate_due_alerts()$$);

-- 08:00 and 20:00 Dubai time: overdue-task digest.
select cron.schedule('overdue-digest-morning', '0 4 * * *', $$select public.generate_overdue_digest()$$);
select cron.schedule('overdue-digest-evening', '0 16 * * *', $$select public.generate_overdue_digest()$$);
