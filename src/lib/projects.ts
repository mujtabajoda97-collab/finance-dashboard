import { toAED, fromAED, round2 } from './currency';
import type { Currency, Project, ProjectCashflow, RateMap } from './types';

/** Amount already paid / received on a cash-flow item. A flow marked done counts as fully paid. */
export const flowPaid = (f: ProjectCashflow): number =>
  f.is_done ? f.amount : Math.min(f.amount, Math.max(0, f.paid_amount ?? 0));
/** What is still pending on the item. */
export const flowRest = (f: ProjectCashflow): number => round2(Math.max(0, f.amount - flowPaid(f)));

export interface ProjectSummary {
  /** executed spending in the project currency */
  spent: number;
  /** planned spending not yet executed */
  pendingOut: number;
  /** expected inflows not yet received (all dates) */
  pendingIn: number;
  /** pending inflows due on/before the target date (undated ones included) */
  inBefore: number;
  /** pending inflows due after the target date (not counted for coverage) */
  inAfter: number;
  /** cost still to be paid = max(budget - spent, pending planned spending) */
  remainingCost: number;
  /** spent + remaining */
  totalCost: number;
  allocated: number;
  /** allocated + inflows before the date - remaining cost (>= 0 surplus, < 0 deficit) */
  net: number;
  /** remaining cost - allocated - ALL pending inflows (never below 0) */
  needed: number;
  /** 0..100 : (spent + allocated) / total cost */
  pct: number;
  /** 0..100 : executed spending share of the bar */
  spentPct: number;
  hasDate: boolean;
  /** whole days from today to the target date (negative = passed), null without a date */
  daysLeft: number | null;
  /** true when some item could not be converted (no rate) and was skipped */
  partial: boolean;
}

function conv(amount: number, from: Currency, to: Currency, rates: RateMap): number | null {
  if (from === to) return amount;
  const a = toAED(amount, from, rates);
  return a === null ? null : fromAED(a, to, rates);
}

export function summarize(p: Project, flows: ProjectCashflow[], rates: RateMap, today: string): ProjectSummary {
  let spent = 0, pendingOut = 0, pendingIn = 0, inBefore = 0, inAfter = 0, partial = false;
  const target = p.target_date ?? null;
  for (const f of flows) {
    if (f.project_id !== p.id) continue;
    const paid = conv(flowPaid(f), f.currency, p.currency, rates);
    const rest = conv(flowRest(f), f.currency, p.currency, rates);
    if (paid === null || rest === null) { partial = true; continue; }
    if (f.direction === 'OUT') {
      spent += paid;
      pendingOut += rest;
    } else {
      pendingIn += rest;
      if (target && f.due_date && f.due_date > target) inAfter += rest; else inBefore += rest;
    }
  }
  const remainingCost = Math.max(0, p.budget - spent, pendingOut);
  const totalCost = spent + remainingCost;
  const pct = totalCost > 0 ? Math.min(100, Math.max(0, ((spent + p.allocated_amount) / totalCost) * 100)) : 0;
  const spentPct = totalCost > 0 ? Math.min(pct, (spent / totalCost) * 100) : 0;
  const daysLeft = target ? Math.round((Date.parse(target) - Date.parse(today)) / 86_400_000) : null;
  return {
    spent: round2(spent),
    pendingOut: round2(pendingOut),
    pendingIn: round2(pendingIn),
    inBefore: round2(inBefore),
    inAfter: round2(inAfter),
    remainingCost: round2(remainingCost),
    totalCost: round2(totalCost),
    allocated: round2(p.allocated_amount),
    net: round2(p.allocated_amount + inBefore - remainingCost),
    needed: round2(Math.max(0, remainingCost - p.allocated_amount - pendingIn)),
    pct,
    spentPct,
    hasDate: !!target,
    daysLeft,
    partial,
  };
}
