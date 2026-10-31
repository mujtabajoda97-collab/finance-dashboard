import { supabase } from './supabase';
import { minutesFromChoice, type AlertChoice } from './alertPrefs';

/** Best effort: store the alert timing on the debt row. Silently ignored until SQL 0005 is applied. */
export async function syncDebtReminder(debtId: string, choice: AlertChoice, due: Date | null): Promise<void> {
  if (!due) return;
  const min = minutesFromChoice(choice, due);
  if (min === null) return;
  try {
    await supabase().from('debts').update({ remind_before_minutes: min }).eq('id', debtId);
  } catch {
    /* column not available yet */
  }
}
