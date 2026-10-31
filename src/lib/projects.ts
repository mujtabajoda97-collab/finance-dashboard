import { toAED, fromAED, round2 } from './currency';
import type { Currency, Project, ProjectCashflow, RateMap } from './types';

export interface ProjectSummary {
  /** 0..100 */
  pct: number;
  inflow: number;
  outflow: number;
  /** allocated + pending inflows - max(budget, pending outflows), in the project's currency */
  net: number;
  /** budget - allocated - pending inflows (never below 0) */
  needed: number;
  /** true when some item could not be converted (no rate) and was skipped */
  partial: boolean;
}

function conv(amount: number, from: Currency, to: Currency, rates: RateMap): number | null {
  if (from === to) return amount;
  const a = toAED(amount, from, rates);
  return a === null ? null : fromAED(a, to, rates);
}

export function summarize(p: Project, flows: ProjectCashflow[], rates: RateMap): ProjectSummary {
  let inflow = 0, outflow = 0, partial = false;
  for (const f of flows) {
    if (f.project_id !== p.id || f.is_done) continue;
    const v = conv(f.amount, f.currency, p.currency, rates);
    if (v === null) { partial = true; continue; }
    if (f.direction === 'IN') inflow += v; else outflow += v;
  }
  const pct = p.budget > 0 ? Math.min(100, Math.max(0, (p.allocated_amount / p.budget) * 100)) : 0;
  const net = round2(p.allocated_amount + inflow - Math.max(p.budget, outflow));
  const needed = round2(Math.max(0, p.budget - p.allocated_amount - inflow));
  return { pct, inflow: round2(inflow), outflow: round2(outflow), net, needed, partial };
}
