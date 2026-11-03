export type Currency = 'AED' | 'SDG' | 'USD';
export const CURRENCIES: Currency[] = ['AED', 'SDG', 'USD'];

export type TxnType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PeriodType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface Wallet {
  id: string;
  name: string;
  currency: Currency;
  opening_balance: number;
  balance: number;
  min_balance_threshold: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExchangeRate {
  id: string;
  base_currency: Currency;
  target_currency: Currency;
  rate: number;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  due_date: string | null;
  period_type: PeriodType;
  remind_before_minutes: number;
  is_completed: boolean;
  completed_at: string | null;
  last_notified_at: string | null;
  created_at: string;
  /** Voice alarm switch. Present only after SQL 0009. */
  alarm_enabled?: boolean;
}

export interface Txn {
  id: string;
  wallet_id: string;
  to_wallet_id: string | null;
  /** Amount received by the destination wallet (wallet-to-wallet transfers). */
  to_amount?: number | null;
  type: TxnType;
  category: string | null;
  amount: number;
  original_amount: number | null;
  original_currency: Currency | null;
  exchange_rate_used: number | null;
  notes: string | null;
  date: string;
  debt_payment_id: string | null;
}

/** Rates expressed as "1 AED = rate × target". AED itself is always 1. */
export type RateMap = Partial<Record<Currency, number>>;

export type DebtType = 'RECEIVABLE' | 'PAYABLE';
export type DebtStatusDb = 'OPEN' | 'PARTIAL' | 'PAID';

export interface Debt {
  id: string;
  person_name: string;
  type: DebtType;
  currency: Currency;
  total_amount: number;
  paid_amount: number;
  due_date: string | null; // YYYY-MM-DD
  status: DebtStatusDb;
  notes: string | null;
  created_at: string;
  /** Present only after SQL 0005 has been applied. */
  remind_before_minutes?: number;
  /** Voice alarm switch. Present only after SQL 0009. */
  alarm_enabled?: boolean;
}

/** One entry of a debt's history added by SQL 0009 (instalments live in debt_payments). */
export interface DebtEvent {
  id: string;
  debt_id: string;
  kind: 'INCREASE';
  amount: number;
  total_before: number;
  total_after: number;
  note: string | null;
  created_at: string;
}

export interface AlertLog {
  id: string;
  alert_type: string;
  message: string;
  created_at: string;
}

export interface Profile {
  display_name: string | null;
  telegram_chat_id: string | null;
  whatsapp_phone: string | null;
  /** Present only after SQL 0006 has been applied. */
  green_api_id_instance?: string | null;
  green_api_token_instance?: string | null;
}

export interface RatePoint {
  rate: number;
  recorded_at: string;
}

export interface Project {
  id: string;
  name: string;
  budget: number;
  currency: Currency;
  allocated_amount: number;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
  /** Event / goal date. Present only after SQL 0007. */
  target_date?: string | null;
}

export interface ProjectCashflow {
  id: string;
  project_id: string;
  direction: 'IN' | 'OUT';
  title: string;
  amount: number;
  currency: Currency;
  due_date: string | null; // YYYY-MM-DD
  is_done: boolean;
  debt_id: string | null;
  /** Amount already paid / received (partial payments). Present only after SQL 0007. */
  paid_amount?: number;
  /** Voice alarm switch. Present only after SQL 0009. */
  alarm_enabled?: boolean;
}

/** Money reserved for a project inside a wallet. Present only after SQL 0008. */
export interface FundReservation {
  id: string;
  project_id: string;
  wallet_id: string;
  /** In the wallet currency. */
  amount: number;
  /** The same money in the project currency. */
  project_amount: number;
  created_at: string;
}

/** Expected money that has not arrived yet. Present only after SQL 0010. */
export interface PendingInflow {
  id: string;
  amount: number;
  currency: Currency;
  description: string;
  due_date: string | null;
  status: 'PENDING' | 'RECEIVED';
  received_wallet_id: string | null;
  received_at: string | null;
  project_id: string | null;
  created_at: string;
}

/** A debtor's WhatsApp reply analysed by the webhook (SQL 0011). */
export interface WaInbox {
  id: string;
  debt_id: string | null;
  from_phone: string;
  body: string;
  category: 'EXTENSION' | 'POSTPONE' | 'APOLOGY' | 'PAID_CLAIM' | 'OTHER';
  summary: string | null;
  suggest_days: number | null;
  suggested_reply: string | null;
  handled: boolean;
  created_at: string;
}
