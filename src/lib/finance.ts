import { convert, round2 } from './currency';
import type { Currency, RateMap, Txn, TxnType, Wallet } from './types';

/** Money is stored as numeric(14,2); compare in integer cents to avoid float drift. */
export const toCents = (n: number) => Math.round((n + Number.EPSILON) * 100);

export type TxnLike = Pick<Txn, 'type' | 'wallet_id' | 'to_wallet_id' | 'amount'> & { to_amount?: number | null };

/**
 * Effect of one transaction on wallet balances (in cents). This mirrors the database trigger
 * `apply_transaction`, so the UI can preview exactly what the database will do.
 */
export function txnEffects(t: TxnLike): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string, c: number) => m.set(id, (m.get(id) ?? 0) + c);
  const c = toCents(t.amount);
  if (t.type === 'INCOME') add(t.wallet_id, c);
  else {
    add(t.wallet_id, -c);
    if (t.type === 'TRANSFER' && t.to_wallet_id) add(t.to_wallet_id, toCents(t.to_amount ?? t.amount));
  }
  return m;
}

/** Balances (cents) after replacing `before` with `after` (either may be null = create / delete). */
export function balancesAfterChange(
  wallets: Pick<Wallet, 'id' | 'balance'>[],
  before: TxnLike | null,
  after: TxnLike | null,
): Map<string, number> {
  const out = new Map(wallets.map((w) => [w.id, toCents(w.balance)]));
  const apply = (t: TxnLike | null, sign: 1 | -1) => {
    if (!t) return;
    for (const [id, c] of txnEffects(t)) if (out.has(id)) out.set(id, (out.get(id) as number) + sign * c);
  };
  apply(before, -1);
  apply(after, 1);
  return out;
}

/** Wallets whose balance would go negative because of the change (and were not negative before). */
export function overdrawn(
  wallets: Pick<Wallet, 'id' | 'balance'>[],
  before: TxnLike | null,
  after: TxnLike | null,
): string[] {
  const next = balancesAfterChange(wallets, before, after);
  return wallets.filter((w) => (next.get(w.id) as number) < 0 && toCents(w.balance) >= 0).map((w) => w.id);
}

export type TransferError = 'amount' | 'sameWallet' | 'toAmount' | 'archived';

export interface TransferInput {
  from: Pick<Wallet, 'id' | 'currency' | 'is_archived'>;
  to: Pick<Wallet, 'id' | 'currency' | 'is_archived'>;
  amount: number;
  /** Amount received. Required when the currencies differ; ignored (= amount) otherwise. */
  toAmount: number | null;
}

export function validateTransfer(i: TransferInput): TransferError | null {
  if (!Number.isFinite(i.amount) || toCents(i.amount) <= 0) return 'amount';
  if (i.from.id === i.to.id) return 'sameWallet';
  if (i.from.is_archived || i.to.is_archived) return 'archived';
  if (i.from.currency !== i.to.currency) {
    if (i.toAmount == null || !Number.isFinite(i.toAmount) || toCents(i.toAmount) <= 0) return 'toAmount';
  }
  return null;
}

/** Suggested received amount for a transfer between currencies (editable by the user). */
export function suggestToAmount(amount: number, from: Currency, to: Currency, rates: RateMap): number | null {
  if (from === to) return round2(amount);
  const v = convert(amount, from, to, rates);
  return v === null ? null : round2(v);
}

export interface TxnRowInput {
  type: TxnType;
  walletId: string;
  toWalletId?: string | null;
  amount: number;
  toAmount?: number | null;
  category: string | null;
  notes: string;
  dateISO: string;
  /** Idempotency key, sent only when the database supports it. */
  requestId?: string | null;
  fromCurrency?: Currency;
  toCurrency?: Currency;
}

/** Row to insert / update for INCOME, EXPENSE and internal TRANSFER. */
export function buildTxnRow(i: TxnRowInput): Record<string, unknown> {
  const isTransfer = i.type === 'TRANSFER';
  const cross = isTransfer && i.fromCurrency && i.toCurrency && i.fromCurrency !== i.toCurrency;
  const row: Record<string, unknown> = {
    wallet_id: i.walletId,
    to_wallet_id: isTransfer ? i.toWalletId ?? null : null,
    type: i.type,
    category: isTransfer ? 'INTERNAL_TRANSFER' : i.category,
    amount: round2(i.amount),
    to_amount: cross ? round2(i.toAmount ?? 0) : null,
    notes: i.notes.trim() || null,
    date: i.dateISO,
  };
  if (i.requestId) row.client_request_id = i.requestId;
  return row;
}

/** Drops re-entrant calls while one is in flight (double tap / double Enter must not post twice). */
export function singleFlight() {
  let busy = false;
  return async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
}
