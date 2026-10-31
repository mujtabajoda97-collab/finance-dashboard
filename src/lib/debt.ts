import { convert, round2 } from './currency';
import { toCents } from './finance';
import type { Currency, RateMap } from './types';

export type DebtStatus = 'OPEN' | 'PARTIAL' | 'PAID';

export const remainingCents = (total: number, paid: number) => Math.max(0, toCents(total) - toCents(paid));
export const remaining = (total: number, paid: number) => remainingCents(total, paid) / 100;

/** Same rule as the database function debt_recalc. */
export function debtStatus(total: number, paid: number): DebtStatus {
  const p = toCents(paid);
  if (p <= 0) return 'OPEN';
  return p >= toCents(total) ? 'PAID' : 'PARTIAL';
}

export type PaymentError = 'amount' | 'settled' | 'exceeds';

/** `amount` is in the debt's own currency. */
export function validatePayment(total: number, paid: number, amount: number): PaymentError | null {
  if (!Number.isFinite(amount) || toCents(amount) <= 0) return 'amount';
  const left = remainingCents(total, paid);
  if (left === 0) return 'settled';
  if (toCents(amount) > left) return 'exceeds';
  return null;
}

/** Suggested amount that leaves/enters the wallet when currencies differ (user may override). */
export function suggestWalletAmount(amount: number, debtCur: Currency, walletCur: Currency, rates: RateMap): number | null {
  if (debtCur === walletCur) return round2(amount);
  const v = convert(amount, debtCur, walletCur, rates);
  return v === null ? null : round2(v);
}

/** Totals for a list of installments, in cents of the debt currency. */
export function paidFromPayments(payments: { amount: number }[]): number {
  return payments.reduce((s, p) => s + toCents(p.amount), 0) / 100;
}
