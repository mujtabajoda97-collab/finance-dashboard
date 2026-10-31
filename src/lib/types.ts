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
}
