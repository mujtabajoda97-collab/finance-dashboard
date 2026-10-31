import { round2 } from './currency';
import type { Currency, FundReservation, Wallet } from './types';

/** Sum of reserved money per wallet (in each wallet's own currency). */
export function reservedByWallet(rows: FundReservation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.wallet_id, round2((m.get(r.wallet_id) ?? 0) + r.amount));
  return m;
}

/** Money reserved for one project inside one wallet. */
export function reservedFor(rows: FundReservation[], projectId: string, walletId: string): number {
  return round2(rows.filter((r) => r.project_id === projectId && r.wallet_id === walletId).reduce((s, r) => s + r.amount, 0));
}

/** Balance that is free for daily spending: total - reserved (never below zero for display). */
export const freeBalance = (w: Pick<Wallet, 'id' | 'balance'>, reserved: Map<string, number>): number =>
  round2(w.balance - (reserved.get(w.id) ?? 0));

/** What a project may spend from a wallet: balance minus money reserved for OTHER projects. */
export const spendableForProject = (w: Pick<Wallet, 'id' | 'balance'>, rows: FundReservation[], projectId: string): number => {
  const others = rows.filter((r) => r.wallet_id === w.id && r.project_id !== projectId).reduce((s, r) => s + r.amount, 0);
  return round2(w.balance - others);
};

export interface CurrencyTotal {
  currency: Currency;
  total: number;
  reserved: number;
  free: number;
  wallets: number;
  low: number;
}

/** One summary per currency that has at least one active wallet, in AED, SDG, USD order. */
export function totalsByCurrency(wallets: Wallet[], reserved: Map<string, number>): CurrencyTotal[] {
  const order: Currency[] = ['AED', 'SDG', 'USD'];
  const out: CurrencyTotal[] = [];
  for (const currency of order) {
    const ws = wallets.filter((w) => w.currency === currency && !w.is_archived);
    if (ws.length === 0) continue;
    const total = round2(ws.reduce((s, w) => s + w.balance, 0));
    const res = round2(ws.reduce((s, w) => s + (reserved.get(w.id) ?? 0), 0));
    out.push({
      currency, total, reserved: res, free: round2(total - res), wallets: ws.length,
      low: ws.filter((w) => w.min_balance_threshold > 0 && w.balance <= w.min_balance_threshold).length,
    });
  }
  return out;
}
